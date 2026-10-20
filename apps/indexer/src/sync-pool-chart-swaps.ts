import { dammPoolAbi, dlmmPoolAbi } from "@zkblast/abi";
import type postgres from "postgres";
import {
  decodeEventLog,
  getAddress,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { persistPoolSwap } from "./persist-pool-swap.js";
import { validateEventForPersistence } from "./validation.js";

const registryAbi = parseAbi([
  "function isRegisteredPool(address) view returns (bool)",
]);
export async function syncPoolChartSwaps(input: {
  client: PublicClient;
  sql: postgres.Sql;
  schema: string;
  chainId: number;
  registry: Address;
  maximumBlocks?: bigint;
  chunkSize?: bigint;
}) {
  const { client, sql, schema, chainId, registry } = input;
  if (
    !/^zkblast_(testnet|mainnet)$/u.test(schema) ||
    (await client.getChainId()) !== chainId
  )
    throw new Error("CHART_NETWORK_MISMATCH");
  const pools = await sql.unsafe<{ address: string; created_block: string }[]>(
    `select address,created_block::text from ${schema}.pools where chain_id=$1`,
    [chainId],
  );
  if (!pools.length) return { swaps: 0, blocks: 0 };
  const addresses: Address[] = [];
  for (const pool of pools) {
    const address = getAddress(pool.address);
    if (
      !(await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "isRegisteredPool",
        args: [address],
      }))
    )
      throw new Error("UNREGISTERED_CHART_POOL");
    addresses.push(address);
  }
  const consumers = addresses.map(
    (address) => `pool-chart:${address.toLowerCase()}`,
  );
  const rows = await sql.unsafe<
    {
      consumer: string;
      last_processed_block: string;
      last_processed_hash: string;
    }[]
  >(
    `select consumer,last_processed_block::text,last_processed_hash from ${schema}.ingestion_checkpoints where consumer=any($1::text[]) and chain_id=$2`,
    [consumers, chainId],
  );
  const head = await client.getBlockNumber();
  if (head < 5n) return { swaps: 0, blocks: 0 };
  const finalized = head - 5n;
  const starts = pools.map((pool, index) => {
    const saved = rows.find((row) => row.consumer === consumers[index]);
    return saved
      ? BigInt(saved.last_processed_block) + 1n
      : BigInt(pool.created_block);
  });
  // Per-pool checkpoints prevent a newly discovered pool from losing older swaps.
  for (const saved of rows)
    if (
      (
        await client.getBlock({
          blockNumber: BigInt(saved.last_processed_block),
        })
      ).hash?.toLowerCase() !== saved.last_processed_hash.toLowerCase()
    )
      throw new Error("CHART_CHECKPOINT_REORG_REQUIRES_RESCAN");
  const start = starts.reduce(
    (min, value) => (value < min ? value : min),
    finalized + 1n,
  );
  if (start > finalized) return { swaps: 0, blocks: 0 };
  const maximum = input.maximumBlocks ?? 20000n;
  const chunk = input.chunkSize ?? 2000n;
  if (maximum < 1n || maximum > 1000000n || chunk < 1n || chunk > 10000n)
    throw new Error("INVALID_CHART_SCAN_BOUND");
  const end =
    start + maximum - 1n < finalized ? start + maximum - 1n : finalized;
  let swaps = 0;
  for (let from = start; from <= end; from += chunk) {
    const to = from + chunk - 1n < end ? from + chunk - 1n : end;
    const logs = await client.getLogs({
      address: addresses.filter((_, index) => starts[index]! <= to),
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
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
      if (
        decoded.eventName !== "Swap" ||
        log.blockNumber === null ||
        log.logIndex === null ||
        !log.transactionHash ||
        !log.blockHash
      )
        continue;
      const [block, receipt] = await Promise.all([
        client.getBlock({ blockNumber: log.blockNumber }),
        client.getTransactionReceipt({ hash: log.transactionHash }),
      ]);
      if (
        block.hash?.toLowerCase() !== log.blockHash.toLowerCase() ||
        receipt.blockHash.toLowerCase() !== log.blockHash.toLowerCase() ||
        receipt.status !== "success"
      )
        throw new Error("CHART_RECEIPT_VALIDATION_FAILED");
      const payload = Object.fromEntries(
        Object.entries(decoded.args).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      );
      const event = validateEventForPersistence(
        {
          chainId,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          contractAddress: getAddress(log.address),
          kind: "swap",
          eventName: "Swap",
          payload: { ...payload, blockTimestamp: block.timestamp.toString() },
        },
        chainId,
      );
      if (await persistPoolSwap(sql, schema, event)) swaps++;
    }
    const block = await client.getBlock({ blockNumber: to });
    if (!block.hash) throw new Error("CHART_SCAN_BLOCK_UNAVAILABLE");
    const completed = consumers.filter((_, index) => starts[index]! <= to);
    await sql.unsafe(
      `insert into ${schema}.ingestion_checkpoints
      (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block)
      select unnest($1::text[]),$2,$3,$4,$3 on conflict (consumer,chain_id) do update set
      last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,
      finalized_block=excluded.finalized_block,updated_at=now()`,
      [completed, chainId, to.toString(), block.hash.toLowerCase()],
    );
  }
  return {
    swaps,
    blocks: Number(end - start + 1n),
    indexedBlock: end.toString(),
    finalizedBlock: finalized.toString(),
  };
}
