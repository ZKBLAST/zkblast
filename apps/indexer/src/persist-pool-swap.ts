import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import { projectPoolSwap, type SwapPool } from "./pool-swap-projection.js";

export async function persistPoolSwap(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
) {
  if (!/^zkblast_(testnet|mainnet)$/u.test(schema))
    throw new Error("INVALID_DATABASE_SCHEMA");
  if (event.eventName !== "Swap" || event.kind !== "swap") return false;
  const pools = await sql.unsafe<SwapPool[]>(
    `select p.id,p.address,p.pool_kind,p.token_x_id,p.token_y_id,
    x.address as token_x_address,y.address as token_y_address from ${schema}.pools p
    join ${schema}.assets x on x.id=p.token_x_id join ${schema}.assets y on y.id=p.token_y_id
    where p.address=$1 and p.chain_id=$2`,
    [event.contractAddress.toLowerCase(), event.chainId],
  );
  const pool = pools[0];
  const swap = pool ? projectPoolSwap(event, pool) : null;
  if (!swap) return false;
  await sql.unsafe(
    `insert into ${schema}.swaps
    (pool_id,chain_id,transaction_hash,log_index,token_in_id,token_out_id,amount_in_raw,amount_out_raw,fee_raw,block_number,block_hash,block_timestamp,canonical)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
    on conflict (chain_id,transaction_hash,log_index) do update set
    pool_id=excluded.pool_id,token_in_id=excluded.token_in_id,token_out_id=excluded.token_out_id,
    amount_in_raw=excluded.amount_in_raw,amount_out_raw=excluded.amount_out_raw,fee_raw=excluded.fee_raw,
    block_number=excluded.block_number,block_hash=excluded.block_hash,block_timestamp=excluded.block_timestamp,canonical=true`,
    [
      swap.poolId,
      event.chainId,
      event.transactionHash.toLowerCase(),
      event.logIndex,
      swap.tokenInId,
      swap.tokenOutId,
      swap.amountIn,
      swap.amountOut,
      swap.fee,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
      swap.observedAt,
    ],
  );
  return true;
}
