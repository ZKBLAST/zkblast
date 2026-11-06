import type postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type { IndexedEvent } from "./domain.js";

const positionEvents = new Set([
  "PositionCreated",
  "PositionIncreased",
  "PositionDecreased",
]);

const raw = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value);
  return /^\d+$/u.test(normalized) ? normalized : null;
};

export async function persistPositionAccounting(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
) {
  if (!isSupportedDatabaseSchema(schema))
    throw new Error("INVALID_DATABASE_SCHEMA");
  if (!positionEvents.has(event.eventName)) return false;
  const positionId = raw(event.payload.positionId);
  if (!positionId) return false;

  const positionRows = await sql.unsafe<{ pool_id: string }[]>(
    `select p.id as pool_id from ${schema}.positions pos
     join ${schema}.pools p on p.id=pos.pool_id
     where pos.onchain_position_id=$1 limit 1`,
    [positionId],
  );
  let poolId = positionRows[0]?.pool_id;
  if (!poolId && typeof event.payload.pool === "string") {
    const poolRows = await sql.unsafe<{ id: string }[]>(
      `select id from ${schema}.pools where chain_id=$1 and address=$2 limit 1`,
      [event.chainId, event.payload.pool.toLowerCase()],
    );
    poolId = poolRows[0]?.id;
  }
  if (!poolId) {
    const creationRows = await sql.unsafe<{ payload: Record<string, unknown> }[]>(
      `select payload from ${schema}.protocol_events
       where chain_id=$1 and event_name='PositionCreated' and canonical
         and payload->>'positionId'=$2 order by block_number desc,log_index desc limit 1`,
      [event.chainId, positionId],
    );
    const createdPool = creationRows[0]?.payload.pool;
    if (typeof createdPool === "string") {
      const poolRows = await sql.unsafe<{ id: string }[]>(
        `select id from ${schema}.pools where chain_id=$1 and address=$2 limit 1`,
        [event.chainId, createdPool.toLowerCase()],
      );
      poolId = poolRows[0]?.id;
    }
  }
  if (!poolId) return false;

  let amount0 = raw(event.payload.amount0);
  let amount1 = raw(event.payload.amount1);
  const action = event.eventName === "PositionDecreased" ? "withdrawal" : "deposit";
  if (action === "deposit") {
    const liquidityRows = await sql.unsafe<{ payload: Record<string, unknown> }[]>(
      `select payload from ${schema}.protocol_events
       where chain_id=$1 and transaction_hash=$2 and log_index<$3 and canonical
         and event_name=any($4::text[])
       order by log_index desc limit 1`,
      [
        event.chainId,
        event.transactionHash.toLowerCase(),
        event.logIndex,
        ["LiquidityAdded", "BinLiquidityAdded"],
      ],
    );
    amount0 = raw(liquidityRows[0]?.payload.amount0);
    amount1 = raw(liquidityRows[0]?.payload.amount1);
  }
  if (!amount0 || !amount1) return false;

  await sql.unsafe(
    `insert into ${schema}.position_accounting_events
      (chain_id,transaction_hash,log_index,pool_id,onchain_position_id,action,
       amount0_raw,amount1_raw,block_number,block_hash,canonical)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
     on conflict (chain_id,transaction_hash,log_index) do update set
       pool_id=excluded.pool_id,onchain_position_id=excluded.onchain_position_id,
       action=excluded.action,amount0_raw=excluded.amount0_raw,amount1_raw=excluded.amount1_raw,
       block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true`,
    [
      event.chainId,
      event.transactionHash.toLowerCase(),
      event.logIndex,
      poolId,
      positionId,
      action,
      amount0,
      amount1,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
    ],
  );
  return true;
}
