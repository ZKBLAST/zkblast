import type postgres from "postgres";

import type { IndexedEvent } from "./domain.js";

function stringValue(event: IndexedEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (typeof value !== "string")
    throw new Error(`INVALID_STOCK_QUOTE_${key.toUpperCase()}`);
  return value.toLowerCase();
}

function optionalStringValue(event: IndexedEvent, key: string): string | null {
  const value = event.payload[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return typeof value === "string" ? value.toLowerCase() : null;
}

const marketStates = [
  "active",
  "after_hours",
  "closed",
  "halted",
  "degraded",
  "emergency",
] as const;

export async function persistStockQuoteEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
): Promise<boolean> {
  const observedAt = event.payload.blockTimestamp
    ? new Date(Number(BigInt(stringValue(event, "blockTimestamp"))) * 1_000)
    : new Date(0);
  if (event.eventName === "StockQuotePolicyBound") {
    await sql.unsafe(
      `insert into ${schema}.stock_quote_launch_policy_bindings(
         chain_id,launch_id,quote_asset_address,policy_identity,transaction_hash,log_index,
         block_number,block_hash,observed_at,canonical)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       on conflict(chain_id,launch_id) do update set
         quote_asset_address=excluded.quote_asset_address,policy_identity=excluded.policy_identity,
         transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,
         block_number=excluded.block_number,block_hash=excluded.block_hash,
         observed_at=excluded.observed_at,canonical=true`,
      [
        event.chainId,
        stringValue(event, "launchId"),
        stringValue(event, "quoteToken"),
        stringValue(event, "policyIdentity"),
        event.transactionHash.toLowerCase(),
        event.logIndex,
        event.blockNumber.toString(),
        event.blockHash.toLowerCase(),
        observedAt,
      ],
    );
    return true;
  }
  if (event.eventName === "StockQuotePolicyValidated") {
    const isBuy = event.payload.isBuy;
    if (typeof isBuy !== "boolean")
      throw new Error("INVALID_STOCK_QUOTE_ISBUY");
    await sql.unsafe(
      `insert into ${schema}.stock_quote_execution_receipts(
         chain_id,transaction_hash,log_index,launch_id,quote_asset_address,policy_identity,is_buy,
         quote_amount_raw,block_number,block_hash,observed_at,canonical,quote_token_decimals,
         multiplier_x18,oracle_price_x18,usd_notional_x18,oracle_updated_at)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,a.token_decimals,
         policy.multiplier_x18,
         case when oracle.price is null then null else floor(oracle.price * 1e18::numeric) end,
         case when oracle.price is null or policy.multiplier_x18 is null then null
           else floor(
             $8::numeric * floor(oracle.price * 1e18::numeric) * policy.multiplier_x18
             / power(10::numeric,a.token_decimals) / 1e18::numeric
           )
         end,
         oracle.observed_at
       from ${schema}.stock_quote_assets a
       left join lateral (
         select p.multiplier_x18
         from ${schema}.stock_quote_policy_events p
         where p.chain_id=$1 and p.contract_address=$5 and p.event_kind='session_updated'
           and p.canonical=true and p.block_number <= $9 and p.multiplier_x18 is not null
         order by p.block_number desc,p.log_index desc limit 1
       ) policy on true
       left join lateral (
         select point.price,point.observed_at
         from ${schema}.external_market_price_points point
         join ${schema}.external_markets market on market.id=point.market_id
         where market.execution_chain_id=$1 and market.contract_address=$5
           and point.source='oracle' and point.observed_at <= $11
         order by point.observed_at desc limit 1
       ) oracle on true
       where a.chain_id=$1 and a.contract_address=$5
       on conflict(chain_id,transaction_hash,log_index) do update set
         launch_id=excluded.launch_id,quote_asset_address=excluded.quote_asset_address,
         policy_identity=excluded.policy_identity,is_buy=excluded.is_buy,
         quote_amount_raw=excluded.quote_amount_raw,block_number=excluded.block_number,
         block_hash=excluded.block_hash,observed_at=excluded.observed_at,
         quote_token_decimals=excluded.quote_token_decimals,
         multiplier_x18=excluded.multiplier_x18,oracle_price_x18=excluded.oracle_price_x18,
         usd_notional_x18=excluded.usd_notional_x18,
         oracle_updated_at=excluded.oracle_updated_at,canonical=true`,
      [
        event.chainId,
        event.transactionHash.toLowerCase(),
        event.logIndex,
        stringValue(event, "launchId"),
        stringValue(event, "quoteAsset"),
        stringValue(event, "policyIdentity"),
        isBuy,
        stringValue(event, "quoteAmountRaw"),
        event.blockNumber.toString(),
        event.blockHash.toLowerCase(),
        observedAt,
      ],
    );
    return true;
  }
  if (event.eventName === "DestinationCapabilityRegistered") {
    await sql.unsafe(
      `insert into ${schema}.stock_quote_destination_capabilities(
         chain_id,capability_id,quote_asset_address,migration_mode,adapter_address,factory_address,
         adapter_version,adapter_configuration_hash,review_reference_hash,registered_at,enabled)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
       on conflict(chain_id,quote_asset_address,migration_mode) do update set
         capability_id=excluded.capability_id,adapter_address=excluded.adapter_address,
         factory_address=excluded.factory_address,adapter_version=excluded.adapter_version,
         adapter_configuration_hash=excluded.adapter_configuration_hash,
         review_reference_hash=excluded.review_reference_hash,registered_at=excluded.registered_at,
         funded_acceptance_hash=null,accepted_at=null,enabled=false,updated_at=now()`,
      [
        event.chainId,
        stringValue(event, "capabilityId"),
        stringValue(event, "quoteAsset"),
        stringValue(event, "mode") === "0" ? "damm" : "dlmm",
        stringValue(event, "adapter"),
        stringValue(event, "factory"),
        stringValue(event, "adapterVersion"),
        stringValue(event, "adapterConfigurationHash"),
        stringValue(event, "reviewReferenceHash"),
        event.payload.blockTimestamp
          ? new Date(
              Number(BigInt(stringValue(event, "blockTimestamp"))) * 1_000,
            )
          : new Date(0),
      ],
    );
    return true;
  }
  if (event.eventName === "DestinationCapabilityAccepted") {
    await sql.unsafe(
      `update ${schema}.stock_quote_destination_capabilities
       set funded_acceptance_hash=$3,accepted_at=$4,enabled=true,updated_at=now()
       where chain_id=$1 and capability_id=$2`,
      [
        event.chainId,
        stringValue(event, "capabilityId"),
        stringValue(event, "fundedAcceptanceHash"),
        event.payload.blockTimestamp
          ? new Date(
              Number(BigInt(stringValue(event, "blockTimestamp"))) * 1_000,
            )
          : new Date(0),
      ],
    );
    return true;
  }
  if (event.eventName === "DestinationCapabilityDisabled") {
    await sql.unsafe(
      `update ${schema}.stock_quote_destination_capabilities
       set enabled=false,updated_at=now() where chain_id=$1 and capability_id=$2`,
      [event.chainId, stringValue(event, "capabilityId")],
    );
    return true;
  }
  const kinds: Readonly<Record<string, string>> = {
    QuoteAssetListed: "listed",
    QuoteAssetConfigUpdated: "updated",
    QuoteAssetDisabled: "disabled",
    SessionPolicyUpdated: "session_updated",
  };
  const eventKind = kinds[event.eventName];
  if (!eventKind) return false;
  const asset = stringValue(event, "asset");
  const version = stringValue(event, "version");
  const configurationHash =
    event.eventName === "QuoteAssetListed" ||
    event.eventName === "QuoteAssetConfigUpdated"
      ? stringValue(event, "configurationHash")
      : null;
  const stateIndex = optionalStringValue(event, "state");
  const marketState =
    event.eventName === "SessionPolicyUpdated" && stateIndex !== null
      ? (marketStates[Number(stateIndex)] ?? null)
      : null;
  const multiplierX18 =
    event.eventName === "SessionPolicyUpdated"
      ? optionalStringValue(event, "multiplierX18")
      : null;
  const policyObservedAtRaw =
    event.eventName === "SessionPolicyUpdated"
      ? optionalStringValue(event, "observedAt")
      : null;
  const policyObservedAt = policyObservedAtRaw
    ? new Date(Number(BigInt(policyObservedAtRaw)) * 1_000)
    : null;
  await sql.unsafe(
    `insert into ${schema}.stock_quote_policy_events(chain_id,transaction_hash,log_index,contract_address,policy_version,event_kind,configuration_hash,block_number,block_hash,canonical,observed_at,market_state,multiplier_x18,policy_observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13)
     on conflict(chain_id,transaction_hash,log_index) do update set policy_version=excluded.policy_version,event_kind=excluded.event_kind,configuration_hash=excluded.configuration_hash,block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true,observed_at=excluded.observed_at,market_state=excluded.market_state,multiplier_x18=excluded.multiplier_x18,policy_observed_at=excluded.policy_observed_at`,
    [
      event.chainId,
      event.transactionHash.toLowerCase(),
      event.logIndex,
      asset,
      version,
      eventKind,
      configurationHash,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
      observedAt,
      marketState,
      multiplierX18,
      policyObservedAt,
    ],
  );
  return true;
}
