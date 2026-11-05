import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";

import type {
  StockQuoteAssetQuery,
  StockQuoteReceiptQuery,
  StockQuoteService,
  ValidatedStockQuoteObservation,
} from "./stock-quote-service.js";

export class PostgresStockQuoteService implements StockQuoteService {
  readonly #sql;
  readonly #schema: string;
  readonly #validatedNotional?: (
    contractAddress: string,
    operation: "create_launch" | "fund" | "buy" | "sell" | "graduate" | "exit",
    amountRaw: string,
  ) => Promise<ValidatedStockQuoteObservation>;

  constructor(
    databaseUrl: string,
    schema: string,
    validatedNotional?: (
      contractAddress: string,
      operation:
        "create_launch" | "fund" | "buy" | "sell" | "graduate" | "exit",
      amountRaw: string,
    ) => Promise<ValidatedStockQuoteObservation>,
  ) {
    if (!isSupportedDatabaseSchema(schema))
      throw new Error("INVALID_DATABASE_SCHEMA");
    this.#schema = schema;
    this.#sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
    if (validatedNotional) this.#validatedNotional = validatedNotional;
  }

  validatedUsdNotional(
    contractAddress: string,
    operation: "create_launch" | "fund" | "buy" | "sell" | "graduate" | "exit",
    amountRaw: string,
  ) {
    if (!this.#validatedNotional)
      throw new Error("VALIDATED_ORACLE_PRICE_UNAVAILABLE");
    return this.#validatedNotional(contractAddress, operation, amountRaw);
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
      [
        query.availability ?? null,
        query.quoteTradingEnabled ?? null,
        query.limit,
      ],
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

  launches(contractAddress: string, limit: number) {
    return this.#sql.unsafe(
      `select l.launch_id as "launchId",l.token_address as "tokenAddress",
        l.virtual_pool as "virtualPool",l.quote_token as "quoteAssetAddress",
        l.name,l.symbol,l.lifecycle,l.real_quote_reserve_raw::text as "realQuoteReserveRaw",
        l.base_sold_raw::text as "baseSoldRaw",l.created_block::text as "createdBlock",
        l.updated_block::text as "updatedBlock",b.policy_identity as "policyIdentity",
        b.transaction_hash as "policyTransactionHash"
       from ${this.#schema}.dbc_launches l
       join ${this.#schema}.stock_quote_launch_policy_bindings b
         on b.launch_id=l.launch_id and b.chain_id=$1 and b.canonical
       where lower(l.quote_token)=$2
       order by l.updated_block desc,l.launch_id limit $3`,
      [4663, contractAddress, limit],
    );
  }

  graduations(contractAddress: string, limit: number) {
    return this.#sql.unsafe(
      `select g.migration_id as "migrationId",g.launch_id as "launchId",
        g.destination_pool as "destinationPool",g.base_migrated_raw::text as "baseMigratedRaw",
        g.quote_migrated_raw::text as "quoteMigratedRaw",
        g.destination_shares_raw::text as "destinationSharesRaw",
        g.transaction_hash as "transactionHash",g.block_number::text as "blockNumber",
        g.observed_at as "observedAt"
       from ${this.#schema}.dbc_graduations g
       join ${this.#schema}.dbc_launches l on l.launch_id=g.launch_id
       join ${this.#schema}.stock_quote_launch_policy_bindings b
         on b.launch_id=l.launch_id and b.chain_id=$1 and b.canonical
       where lower(l.quote_token)=$2
       order by g.block_number desc,g.migration_id limit $3`,
      [4663, contractAddress, limit],
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
        block_hash as "blockHash",observed_at as "observedAt",
        quote_token_decimals as "quoteTokenDecimals",multiplier_x18::text as "multiplierX18",
        oracle_price_x18::text as "oraclePriceX18",usd_notional_x18::text as "usdNotionalX18",
        oracle_updated_at as "oracleUpdatedAt",oracle_round_id::text as "oracleRoundId"
       from ${this.#schema}.stock_quote_execution_receipts
       where canonical=true
         and ($1::text is null or launch_id=$1)
         and ($2::text is null or quote_asset_address=$2)
       order by block_number desc,log_index desc limit $3`,
      [query.launchId ?? null, query.quoteAssetAddress ?? null, query.limit],
    );
  }
}
