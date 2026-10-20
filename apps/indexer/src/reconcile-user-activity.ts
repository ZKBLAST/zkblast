import { positionManagerAbi, dammPoolAbi, dlmmPoolAbi } from "@zkblast/abi";
import type postgres from "postgres";
import {
  decodeEventLog,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { persistPoolSwap } from "./persist-pool-swap.js";
import { validateEventForPersistence } from "./validation.js";

/** Only already-authenticated wallets receive user records; observing an address never creates a login. */
export async function reconcileUserActivity(input: {
  client: PublicClient;
  sql: postgres.Sql;
  schema: string;
  chainId: number;
  positionManager: Address;
  confirmations?: bigint;
}) {
  const { client, sql, schema, chainId, positionManager } = input;
  if (
    !/^zkblast_(mainnet|testnet)$/u.test(schema) ||
    (await client.getChainId()) !== chainId
  )
    throw new Error("ACTIVITY_CHAIN_MISMATCH");
  const head = await client.getBlockNumber();
  const confirmations = input.confirmations ?? 5n;
  if (confirmations < 1n || head < confirmations)
    throw new Error("ACTIVITY_FINALITY_UNAVAILABLE");
  const block = await client.getBlock({ blockNumber: head - confirmations });
  const wallets = await sql.unsafe<
    { id: string; user_id: string; wallet_address: string }[]
  >(`select id,user_id,wallet_address from ${schema}.user_wallets`);
  const owners = new Map(wallets.map((w) => [w.wallet_address, w]));
  const pools = await sql.unsafe<
    { id: string; address: string; pool_kind: string }[]
  >(`select id,address,pool_kind from ${schema}.pools where chain_id=$1`, [
    chainId,
  ]);
  const next = await client.readContract({
    address: positionManager,
    abi: positionManagerAbi,
    functionName: "nextPositionId",
    blockNumber: block.number,
  });
  if (next > 5001n) throw new Error("POSITION_SCAN_LIMIT_EXCEEDED");
  const creations = await sql.unsafe<
    {
      payload: Record<string, unknown>;
      block_number: string;
      block_hash: string;
    }[]
  >(
    `select case when jsonb_typeof(payload)='string' then (payload#>>'{}')::jsonb else payload end as payload,block_number::text,block_hash
      from ${schema}.protocol_events where chain_id=$1 and contract_address=$2 and event_name='PositionCreated' and canonical`,
    [chainId, positionManager.toLowerCase()],
  );
  const stats = {
    positions: 0,
    closedOrTransferred: 0,
    unlinkedOwners: 0,
    history: 0,
    swapsReplayed: 0,
  };
  for (let id = 1n; id < next; id++) {
    const [owner, pool, model, bin, shares] = await client.readContract({
      address: positionManager,
      abi: positionManagerAbi,
      functionName: "positions",
      args: [id],
      blockNumber: block.number,
    });
    const stored = pools.find((p) => p.address === pool.toLowerCase());
    if (!stored) continue;
    if ((model === 0 ? "damm" : "dlmm") !== stored.pool_kind || shares < 0n)
      throw new Error("POSITION_METADATA_MISMATCH");
    const wallet = owners.get(owner.toLowerCase());
    if (
      (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
    )
      throw new Error("ACTIVITY_SNAPSHOT_REORG");
    if (!wallet) {
      stats.unlinkedOwners++;
      await sql.unsafe(
        `update ${schema}.positions set status='closed',liquidity_raw=0,updated_at=now()
        where pool_id=$1 and onchain_position_id=$2 and wallet_id in
          (select id from ${schema}.user_wallets where wallet_address<>$3)`,
        [stored.id, id.toString(), owner.toLowerCase()],
      );
      continue;
    }
    const created = creations.find(
      (event) => String(event.payload.positionId) === id.toString(),
    );
    if (!created) continue; // Never invent the position's opening timestamp.
    const origin = await client.getBlock({
      blockNumber: BigInt(created.block_number),
    });
    if (
      !origin.hash ||
      origin.hash.toLowerCase() !== created.block_hash ||
      origin.number > block.number
    )
      throw new Error("POSITION_ORIGIN_UNAVAILABLE");
    if (
      (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
    )
      throw new Error("ACTIVITY_SNAPSHOT_REORG");
    await sql.unsafe(
      `insert into ${schema}.positions
      (user_id,wallet_id,pool_id,onchain_position_id,liquidity_raw,lower_bound,upper_bound,status,opened_at)
      values ($1,$2,$3,$4,$5,$6,$6,$7,$8) on conflict (pool_id,onchain_position_id) do update set
      user_id=excluded.user_id,wallet_id=excluded.wallet_id,liquidity_raw=excluded.liquidity_raw,
      lower_bound=excluded.lower_bound,upper_bound=excluded.upper_bound,status=excluded.status,updated_at=now()`,
      [
        wallet.user_id,
        wallet.id,
        stored.id,
        id.toString(),
        shares.toString(),
        model === 1 ? bin : null,
        shares > 0n ? "open" : "closed",
        new Date(Number(origin.timestamp) * 1000),
      ],
    );
    stats.positions++;
    if (shares === 0n) stats.closedOrTransferred++;
  }
  if (
    (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
  )
    throw new Error("ACTIVITY_SNAPSHOT_REORG");
  await sql.unsafe(
    `update ${schema}.positions set status='closed',liquidity_raw=0,updated_at=now()
    where status='open' and pool_id in (select id from ${schema}.pools where chain_id=$1)
      and (case when onchain_position_id ~ '^[0-9]+$' then onchain_position_id::numeric end) >= $2`,
    [chainId, next.toString()],
  );
  const swaps = await sql.unsafe<
    { transaction_hash: Hash; block_hash: string; block_number: string }[]
  >(
    `select distinct transaction_hash,block_hash,block_number::text from (
     select s.transaction_hash,s.block_hash,s.block_number from ${schema}.swaps s
     where s.chain_id=$1 and s.canonical and (s.wallet_id is null or not exists
       (select 1 from ${schema}.trade_history h where h.chain_id=s.chain_id and h.transaction_hash=s.transaction_hash and h.log_index=s.log_index))
     union all
     select e.transaction_hash,e.block_hash,e.block_number from ${schema}.protocol_events e
       join ${schema}.pools p on p.address=e.contract_address and p.chain_id=e.chain_id
       where e.chain_id=$1 and e.canonical and e.event_name='Swap' and not exists
         (select 1 from ${schema}.swaps s where s.chain_id=e.chain_id and s.transaction_hash=e.transaction_hash and s.log_index=e.log_index and s.canonical)
     ) candidates limit 1000`,
    [chainId],
  );
  for (const swap of swaps) {
    const receipt = await client.getTransactionReceipt({
      hash: swap.transaction_hash,
    });
    if (
      receipt.status !== "success" ||
      receipt.blockHash.toLowerCase() !== swap.block_hash ||
      receipt.blockNumber !== BigInt(swap.block_number) ||
      receipt.blockNumber > block.number
    )
      throw new Error("HISTORY_RECEIPT_MISMATCH");
    const canonical = await client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (canonical.hash !== receipt.blockHash) throw new Error("HISTORY_REORG");
    const indexes: number[] = [];
    for (const log of receipt.logs) {
      if (
        log.logIndex === null ||
        !pools.some((pool) => pool.address === log.address.toLowerCase())
      )
        continue;
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: [...dammPoolAbi, ...dlmmPoolAbi],
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }
      if (decoded.eventName !== "Swap") continue;
      const payload = Object.fromEntries(
        Object.entries(decoded.args).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      );
      const event = validateEventForPersistence(
        {
          chainId,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          transactionHash: receipt.transactionHash,
          logIndex: log.logIndex,
          contractAddress: log.address,
          kind: "swap",
          eventName: "Swap",
          payload: {
            ...payload,
            blockTimestamp: canonical.timestamp.toString(),
          },
        },
        chainId,
      );
      if (await persistPoolSwap(sql, schema, event)) {
        indexes.push(log.logIndex);
        stats.swapsReplayed++;
      }
    }
    const wallet = owners.get(receipt.from.toLowerCase());
    if (!wallet) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `update ${schema}.swaps set user_id=$1,wallet_id=$2 where chain_id=$3 and transaction_hash=$4 and canonical and log_index=any($5::int[])`,
        [wallet.user_id, wallet.id, chainId, swap.transaction_hash, indexes],
      );
      const rows = await tx.unsafe(
        `insert into ${schema}.trade_history
       (user_id,wallet_id,client_request_id,chain_id,transaction_hash,log_index,action,status,venue,pool_address,
        token_in_address,token_out_address,amount_in_raw,amount_out_raw,fee_raw,block_number,block_timestamp,gas_used,effective_gas_price_wei,submitted_at,confirmed_at)
       select s.user_id,s.wallet_id,extensions.gen_random_uuid(),s.chain_id,s.transaction_hash,s.log_index,'swap','confirmed',
         'zkblast_'||p.pool_kind,p.address,x.address,y.address,s.amount_in_raw,s.amount_out_raw,s.fee_raw,
         s.block_number,s.block_timestamp,$3,$4,s.block_timestamp,s.block_timestamp
       from ${schema}.swaps s join ${schema}.pools p on p.id=s.pool_id
       join ${schema}.assets x on x.id=s.token_in_id join ${schema}.assets y on y.id=s.token_out_id
       where s.chain_id=$1 and s.transaction_hash=$2 and s.wallet_id=$5 and s.canonical and s.log_index=any($6::int[])
       on conflict (chain_id,transaction_hash,log_index) where transaction_hash is not null and log_index is not null
       do update set status='confirmed',gas_used=excluded.gas_used,effective_gas_price_wei=excluded.effective_gas_price_wei,
         block_number=excluded.block_number,block_timestamp=excluded.block_timestamp,confirmed_at=excluded.confirmed_at
       where ${schema}.trade_history.user_id=excluded.user_id and ${schema}.trade_history.wallet_id=excluded.wallet_id returning id`,
        [
          chainId,
          swap.transaction_hash,
          receipt.gasUsed.toString(),
          receipt.effectiveGasPrice.toString(),
          wallet.id,
          indexes,
        ],
      );
      stats.history += rows.length;
    });
  }
  return stats;
}
