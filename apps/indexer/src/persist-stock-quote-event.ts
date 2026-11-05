import type postgres from "postgres";

import type { IndexedEvent } from "./domain.js";

function stringValue(event: IndexedEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") throw new Error(`INVALID_STOCK_QUOTE_${key.toUpperCase()}`);
  return value.toLowerCase();
}

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
    if (typeof isBuy !== "boolean") throw new Error("INVALID_STOCK_QUOTE_ISBUY");
    await sql.unsafe(
      `insert into ${schema}.stock_quote_execution_receipts(
         chain_id,transaction_hash,log_index,launch_id,quote_asset_address,policy_identity,is_buy,
         quote_amount_raw,block_number,block_hash,observed_at,canonical)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       on conflict(chain_id,transaction_hash,log_index) do update set
         launch_id=excluded.launch_id,quote_asset_address=excluded.quote_asset_address,
         policy_identity=excluded.policy_identity,is_buy=excluded.is_buy,
         quote_amount_raw=excluded.quote_amount_raw,block_number=excluded.block_number,
         block_hash=excluded.block_hash,observed_at=excluded.observed_at,canonical=true`,
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
          ? new Date(Number(BigInt(stringValue(event, "blockTimestamp"))) * 1_000)
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
          ? new Date(Number(BigInt(stringValue(event, "blockTimestamp"))) * 1_000)
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
    event.eventName === "QuoteAssetListed" || event.eventName === "QuoteAssetConfigUpdated"
      ? stringValue(event, "configurationHash")
      : null;
  await sql.unsafe(
    `insert into ${schema}.stock_quote_policy_events(chain_id,transaction_hash,log_index,contract_address,policy_version,event_kind,configuration_hash,block_number,block_hash,canonical,observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
     on conflict(chain_id,transaction_hash,log_index) do update set policy_version=excluded.policy_version,event_kind=excluded.event_kind,configuration_hash=excluded.configuration_hash,block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true,observed_at=excluded.observed_at`,
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
    ],
  );
  return true;
}
