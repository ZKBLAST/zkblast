import { dammPoolAbi, dlmmPoolAbi } from "@zkblast/abi";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type postgres from "postgres";
import { getAddress, type PublicClient } from "viem";

import {
  poolSpotPriceX18,
  type SwapPool,
} from "./pool-swap-projection.js";

type PoolRow = SwapPool & { chain_id: number };

/** Periodic finalized-block check that repairs projection drift from canonical onchain state. */
export async function reconcilePoolState(input: {
  client: PublicClient;
  sql: postgres.Sql;
  schema: string;
  chainId: number;
}) {
  if (
    !isSupportedDatabaseSchema(input.schema) ||
    (await input.client.getChainId()) !== input.chainId
  ) throw new Error("POOL_STATE_NETWORK_MISMATCH");
  const head = await input.client.getBlockNumber();
  if (head < 5n) return { checked: 0, repaired: 0, observedBlock: null };
  const observedBlock = head - 5n;
  const block = await input.client.getBlock({ blockNumber: observedBlock });
  if (!block.hash) throw new Error("POOL_STATE_BLOCK_UNAVAILABLE");
  const pools = await input.sql.unsafe<PoolRow[]>(
    `select p.id,p.chain_id::integer,p.address,p.pool_kind,p.token_x_id,p.token_y_id,
      p.quote_token_id,p.bin_step_bps,x.address as token_x_address,
      x.decimals::integer as token_x_decimals,y.address as token_y_address,
      y.decimals::integer as token_y_decimals
     from ${input.schema}.pools p
     join ${input.schema}.assets x on x.id=p.token_x_id
     join ${input.schema}.assets y on y.id=p.token_y_id
     where p.chain_id=$1 and p.status in ('active','paused')`,
    [input.chainId],
  );
  let repaired = 0;
  for (const pool of pools) {
    const address = getAddress(pool.address);
    let reserve0: bigint;
    let reserve1: bigint;
    let activeBin: number | null = null;
    let binState: readonly [bigint, bigint, bigint, bigint] | null = null;
    if (pool.pool_kind === "damm") {
      [reserve0, reserve1] = await Promise.all([
        input.client.readContract({ address, abi: dammPoolAbi, functionName: "reserve0", blockNumber: observedBlock }),
        input.client.readContract({ address, abi: dammPoolAbi, functionName: "reserve1", blockNumber: observedBlock }),
      ]);
    } else {
      activeBin = await input.client.readContract({
        address,
        abi: dlmmPoolAbi,
        functionName: "activeBin",
        blockNumber: observedBlock,
      });
      binState = await input.client.readContract({
        address,
        abi: dlmmPoolAbi,
        functionName: "binState",
        args: [activeBin],
        blockNumber: observedBlock,
      });
      [reserve0, reserve1] = binState;
    }
    const spot = poolSpotPriceX18(pool, reserve0, reserve1, activeBin);
    const previous = await input.sql.unsafe<{
      reserve0_raw: string;
      reserve1_raw: string;
      active_bin: number | null;
      spot_price_x18: string | null;
    }[]>(
      `select reserve0_raw::text,reserve1_raw::text,active_bin,spot_price_x18::text
       from ${input.schema}.pool_state where pool_id=$1`,
      [pool.id],
    );
    const changed =
      !previous[0] ||
      previous[0].reserve0_raw !== reserve0.toString() ||
      previous[0].reserve1_raw !== reserve1.toString() ||
      previous[0].active_bin !== activeBin ||
      previous[0].spot_price_x18 !== (spot?.toString() ?? null);
    await input.sql.begin(async (transaction) => {
      await transaction.unsafe(
        `insert into ${input.schema}.pool_state
         (pool_id,chain_id,reserve0_raw,reserve1_raw,active_bin,spot_price_x18,
          observed_block,observed_block_hash,observed_log_index,observed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9)
         on conflict(pool_id) do update set reserve0_raw=excluded.reserve0_raw,
          reserve1_raw=excluded.reserve1_raw,active_bin=excluded.active_bin,
          spot_price_x18=excluded.spot_price_x18,observed_block=excluded.observed_block,
          observed_block_hash=excluded.observed_block_hash,observed_log_index=0,
          observed_at=excluded.observed_at,updated_at=now()
         where excluded.observed_block>=${input.schema}.pool_state.observed_block`,
        [pool.id, input.chainId, reserve0.toString(), reserve1.toString(), activeBin,
          spot?.toString() ?? null, observedBlock.toString(), block.hash.toLowerCase(),
          new Date(Number(block.timestamp) * 1_000)],
      );
      if (activeBin !== null && binState)
        await transaction.unsafe(
          `insert into ${input.schema}.dlmm_bins
           (pool_id,bin_id,reserve0_raw,reserve1_raw,total_shares_raw,price_x18,
            observed_block,observed_block_hash,observed_at,canonical)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
           on conflict(pool_id,bin_id,observed_block_hash) do nothing`,
          [pool.id, activeBin, binState[0].toString(), binState[1].toString(),
            binState[2].toString(), binState[3].toString(), observedBlock.toString(),
            block.hash.toLowerCase(), new Date(Number(block.timestamp) * 1_000)],
        );
    });
    if (changed) repaired++;
  }
  return { checked: pools.length, repaired, observedBlock: observedBlock.toString() };
}
