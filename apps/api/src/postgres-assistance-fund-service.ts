import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type {
  AssistanceFundService,
  AssistancePageQuery,
} from "./assistance-fund-service.js";

export class PostgresAssistanceFundService implements AssistanceFundService {
  private readonly sql;
  private readonly schema: string;

  constructor(databaseUrl: string, schema: string) {
    if (!isSupportedDatabaseSchema(schema))
      throw new Error("INVALID_DATABASE_SCHEMA");
    this.schema = schema;
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  async summary(asset?: string): Promise<Readonly<Record<string, unknown>>> {
    const rows = await this.sql.unsafe(
      `select asset_address as "assetAddress",
        coalesce(sum(eligible_amount_raw),0)::text as "eligibleAmountRaw",
        coalesce(sum(buyback_amount_raw),0)::text as "allocatedBuybackRaw",
        coalesce(sum(treasury_amount_raw),0)::text as "allocatedTreasuryRaw"
       from ${this.schema}.assistance_allocations
       where ($1::text is null or asset_address=$1)
       group by asset_address order by asset_address`,
      [asset ?? null],
    );
    const burnRows = await this.sql.unsafe(
      `select coalesce(sum(amount_raw),0)::text as "burnedProtocolTokenRaw",
        max(block_number)::text as "latestBlock"
       from ${this.schema}.assistance_burn_receipts`,
    );
    const windows = await this.sql.unsafe(
      `select
        coalesce(sum(eligible_amount_raw) filter(where observed_at >= now()-interval '24 hours'),0)::text as "eligible24hRaw",
        coalesce(sum(eligible_amount_raw) filter(where observed_at >= now()-interval '7 days'),0)::text as "eligible7dRaw",
        coalesce(sum(eligible_amount_raw) filter(where observed_at >= now()-interval '30 days'),0)::text as "eligible30dRaw"
       from ${this.schema}.assistance_revenue_receipts
       where ($1::text is null or asset_address=$1)`,
      [asset ?? null],
    );
    const reconciliation = await this.sql.unsafe(
      `select distinct on(asset_address) asset_address as "assetAddress",balance_raw::text as "balanceRaw",
        pending_buyback_raw::text as "pendingBuybackRaw",treasury_claimable_raw::text as "treasuryClaimableRaw",
        liability_raw::text as "liabilityRaw",surplus_raw::text as "surplusRaw",solvent,block_number::text as "blockNumber"
       from ${this.schema}.assistance_reconciliation_snapshots
       where ($1::text is null or asset_address=$1)
       order by asset_address,block_number desc`,
      [asset ?? null],
    );
    return {
      assets: rows,
      windows: windows[0] ?? {
        eligible24hRaw: "0",
        eligible7dRaw: "0",
        eligible30dRaw: "0",
      },
      reconciliation,
      burnedProtocolTokenRaw:
        (burnRows[0] as { burnedProtocolTokenRaw?: string } | undefined)
          ?.burnedProtocolTokenRaw ?? "0",
      latestBlock:
        (burnRows[0] as { latestBlock?: string | null } | undefined)
          ?.latestBlock ?? null,
    };
  }

  revenue(query: AssistancePageQuery) {
    return this.sql.unsafe(
      `select source_id as "sourceId",epoch_id as "epochId",asset_address as "assetAddress",
        revenue_kind as "revenueKind",gross_amount_raw::text as "grossAmountRaw",
        excluded_obligations_raw::text as "excludedObligationsRaw",eligible_amount_raw::text as "eligibleAmountRaw",
        transaction_hash as "transactionHash",log_index as "logIndex",block_number::text as "blockNumber",observed_at as "observedAt"
       from ${this.schema}.assistance_revenue_receipts
       where ($1::text is null or transaction_hash<$1) and ($2::text is null or asset_address=$2)
         and ($3::text is null or source_id=$3)
       order by block_number desc,log_index desc limit $4`,
      [
        query.cursor ?? null,
        query.asset ?? null,
        query.sourceId ?? null,
        query.limit,
      ],
    );
  }

  buybacks(query: AssistancePageQuery) {
    return this.sql.unsafe(
      `select route_id as "routeId",asset_in as "assetIn",protocol_token as "protocolToken",
        amount_in_raw::text as "amountInRaw",amount_out_raw::text as "amountOutRaw",
        reference_price_x18::text as "referencePriceX18",execution_price_x18::text as "executionPriceX18",
        executor_address as "executorAddress",transaction_hash as "transactionHash",log_index as "logIndex",
        block_number::text as "blockNumber",observed_at as "observedAt"
       from ${this.schema}.assistance_buyback_receipts
       where ($1::text is null or transaction_hash<$1) and ($2::text is null or asset_in=$2)
       order by block_number desc,log_index desc limit $3`,
      [query.cursor ?? null, query.asset ?? null, query.limit],
    );
  }

  burns(query: AssistancePageQuery) {
    return this.sql.unsafe(
      `select protocol_token as "protocolToken",burn_method as "burnMethod",amount_raw::text as "amountRaw",
        total_supply_before_raw::text as "totalSupplyBeforeRaw",total_supply_after_raw::text as "totalSupplyAfterRaw",
        executor_address as "executorAddress",transaction_hash as "transactionHash",log_index as "logIndex",
        block_number::text as "blockNumber",observed_at as "observedAt"
       from ${this.schema}.assistance_burn_receipts
       where ($1::text is null or transaction_hash<$1) and ($2::text is null or protocol_token=$2)
       order by block_number desc,log_index desc limit $3`,
      [query.cursor ?? null, query.asset ?? null, query.limit],
    );
  }
}
