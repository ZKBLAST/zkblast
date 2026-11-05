import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";

import type {
  StockQuoteAssetQuery,
  StockQuoteReceiptQuery,
  StockQuoteService,
} from "./stock-quote-service.js";

export class PostgresStockQuoteService implements StockQuoteService {
  readonly #sql;
  readonly #schema: string;

  constructor(databaseUrl: string, schema: string) {
    if (!isSupportedDatabaseSchema(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#schema = schema;
    this.#sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 10 });
  }

  assets(query: StockQuoteAssetQuery) {
    return this.#sql.unsafe(
      `select chain_id as "chainId",contract_address as "contractAddress",issuer_asset_id as "issuerAssetId",
        symbol,instrument_name as "instrumentName",issuer_name as "issuerName",token_decimals as "tokenDecimals",
        current_multiplier::text as "currentMultiplier",pending_multiplier::text as "pendingMultiplier",
        availability,market_state as "marketState",quote_trading_enabled as "quoteTradingEnabled",
        graduation_enabled as "graduationEnabled",price_feed_address as "priceFeedAddress",
        max_oracle_age_seconds as "maxOracleAgeSeconds",source_observed_at as "sourceObservedAt",updated_at as "updatedAt"
       from ${this.#schema}.stock_quote_assets
       where ($1::text is null or availability=$1)
         and ($2::boolean is null or quote_trading_enabled=$2)
       order by quote_trading_enabled desc,symbol asc limit $3`,
      [query.availability ?? null, query.quoteTradingEnabled ?? null, query.limit],
    );
  }

  async asset(contractAddress: string) {
    const rows = await this.#sql.unsafe(
      `select chain_id as "chainId",contract_address as "contractAddress",issuer_asset_id as "issuerAssetId",
        symbol,instrument_name as "instrumentName",issuer_name as "issuerName",token_decimals as "tokenDecimals",
        current_multiplier::text as "currentMultiplier",pending_multiplier::text as "pendingMultiplier",
        availability,market_state as "marketState",quote_trading_enabled as "quoteTradingEnabled",
        graduation_enabled as "graduationEnabled",price_feed_address as "priceFeedAddress",
        max_oracle_age_seconds as "maxOracleAgeSeconds",source_observed_at as "sourceObservedAt",updated_at as "updatedAt"
       from ${this.#schema}.stock_quote_assets where contract_address=$1 limit 1`,
      [contractAddress],
    );
    return (rows[0] as Readonly<Record<string, unknown>> | undefined) ?? null;
  }

  destinationCapabilities(contractAddress: string) {
    return this.#sql.unsafe(
      `select capability_id as "capabilityId",migration_mode as "migrationMode",adapter_address as "adapterAddress",
        factory_address as "factoryAddress",adapter_version as "adapterVersion",
        adapter_configuration_hash as "adapterConfigurationHash",
        review_reference_hash as "reviewReferenceHash",
        funded_acceptance_hash as "fundedAcceptanceHash",registered_at as "registeredAt",
        accepted_at as "acceptedAt",enabled
       from ${this.#schema}.stock_quote_destination_capabilities
       where quote_asset_address=$1 order by migration_mode asc`,
      [contractAddress],
    );
  }

  launchPolicyBindings(query: StockQuoteReceiptQuery) {
    return this.#sql.unsafe(
      `select chain_id as "chainId",launch_id as "launchId",quote_asset_address as "quoteAssetAddress",
        policy_identity as "policyIdentity",transaction_hash as "transactionHash",log_index as "logIndex",
        block_number::text as "blockNumber",block_hash as "blockHash",observed_at as "observedAt"
       from ${this.#schema}.stock_quote_launch_policy_bindings
       where canonical=true
         and ($1::text is null or launch_id=$1)
         and ($2::text is null or quote_asset_address=$2)
       order by block_number desc,log_index desc limit $3`,
      [query.launchId ?? null, query.quoteAssetAddress ?? null, query.limit],
    );
  }

  executionReceipts(query: StockQuoteReceiptQuery) {
    return this.#sql.unsafe(
      `select chain_id as "chainId",transaction_hash as "transactionHash",log_index as "logIndex",
        launch_id as "launchId",quote_asset_address as "quoteAssetAddress",policy_identity as "policyIdentity",
        is_buy as "isBuy",quote_amount_raw::text as "quoteAmountRaw",block_number::text as "blockNumber",
        block_hash as "blockHash",observed_at as "observedAt"
       from ${this.#schema}.stock_quote_execution_receipts
       where canonical=true
         and ($1::text is null or launch_id=$1)
         and ($2::text is null or quote_asset_address=$2)
       order by block_number desc,log_index desc limit $3`,
      [query.launchId ?? null, query.quoteAssetAddress ?? null, query.limit],
    );
  }
}
