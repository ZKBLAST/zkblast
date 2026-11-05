import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import { projectAssistanceFundEvent } from "./assistance-fund-projection.js";

export async function persistAssistanceFundEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
): Promise<boolean> {
  const receipt = projectAssistanceFundEvent(event);
  if (!receipt) return false;
  const timestamp = event.payload.blockTimestamp;
  const observedAt =
    typeof timestamp === "string" && /^\d+$/u.test(timestamp)
      ? new Date(Number(BigInt(timestamp)) * 1_000)
      : new Date(0);
  const base: readonly [number, string, number, string, Date] = [
    receipt.chainId,
    receipt.transactionHash.toLowerCase(),
    receipt.logIndex,
    receipt.blockNumber.toString(),
    observedAt,
  ];
  if (receipt.kind === "source") {
    await sql.unsafe(
      `insert into ${schema}.assistance_fee_sources(chain_id,source_id,source_address,asset_address,adapter_id,status,block_number,transaction_hash,log_index,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(chain_id,source_id) do update set source_address=excluded.source_address,asset_address=excluded.asset_address,adapter_id=excluded.adapter_id,status=excluded.status,block_number=excluded.block_number,transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,observed_at=excluded.observed_at`,
      [
        receipt.chainId,
        receipt.sourceId,
        receipt.sourceAddress,
        receipt.assetAddress,
        receipt.adapterId,
        receipt.status,
        receipt.blockNumber.toString(),
        receipt.transactionHash,
        receipt.logIndex,
        observedAt,
      ],
    );
  } else if (receipt.kind === "revenue") {
    await sql.unsafe(
      `insert into ${schema}.assistance_revenue_receipts(chain_id,transaction_hash,log_index,source_id,epoch_id,asset_address,revenue_kind,gross_amount_raw,excluded_obligations_raw,eligible_amount_raw,block_number,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(chain_id,transaction_hash,log_index) do nothing`,
      [
        base[0],
        base[1],
        base[2],
        receipt.sourceId,
        receipt.epochId,
        receipt.assetAddress,
        receipt.revenueKind,
        receipt.grossAmountRaw.toString(),
        receipt.excludedObligationsRaw.toString(),
        receipt.eligibleAmountRaw.toString(),
        base[3],
        base[4],
      ],
    );
  } else if (receipt.kind === "allocation") {
    await sql.unsafe(
      `insert into ${schema}.assistance_allocations(chain_id,transaction_hash,log_index,source_id,epoch_id,asset_address,eligible_amount_raw,buyback_amount_raw,treasury_amount_raw,block_number,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(chain_id,transaction_hash,log_index) do nothing`,
      [
        base[0],
        base[1],
        base[2],
        receipt.sourceId,
        receipt.epochId,
        receipt.assetAddress,
        receipt.eligibleAmountRaw.toString(),
        receipt.buybackAmountRaw.toString(),
        receipt.treasuryAmountRaw.toString(),
        base[3],
        base[4],
      ],
    );
  } else if (receipt.kind === "buyback") {
    await sql.unsafe(
      `insert into ${schema}.assistance_buyback_receipts(chain_id,transaction_hash,log_index,route_id,asset_in,protocol_token,amount_in_raw,amount_out_raw,reference_price_x18,execution_price_x18,executor_address,block_number,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(chain_id,transaction_hash,log_index) do nothing`,
      [
        base[0],
        base[1],
        base[2],
        receipt.routeId,
        receipt.assetIn,
        receipt.protocolToken,
        receipt.amountInRaw.toString(),
        receipt.amountOutRaw.toString(),
        receipt.referencePriceX18.toString(),
        receipt.executionPriceX18.toString(),
        receipt.executorAddress,
        base[3],
        base[4],
      ],
    );
  } else {
    await sql.unsafe(
      `insert into ${schema}.assistance_burn_receipts(chain_id,transaction_hash,log_index,protocol_token,burn_method,amount_raw,total_supply_before_raw,total_supply_after_raw,executor_address,block_number,observed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(chain_id,transaction_hash,log_index) do nothing`,
      [
        base[0],
        base[1],
        base[2],
        receipt.protocolToken,
        receipt.burnMethod,
        receipt.amountRaw.toString(),
        receipt.totalSupplyBeforeRaw.toString(),
        receipt.totalSupplyAfterRaw.toString(),
        receipt.executorAddress,
        base[3],
        base[4],
      ],
    );
  }
  return true;
}
