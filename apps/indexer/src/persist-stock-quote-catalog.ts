import {
  stockQuoteCatalogRecordSchema,
  type StockQuoteCatalogRecord,
} from "@zkblast/database";

type UnsafeSql = Readonly<{
  unsafe(query: string, parameters?: readonly unknown[]): Promise<unknown>;
}>;

export type StockQuoteCatalogSnapshot = Readonly<{
  chainId: 4663;
  sourceHash: string;
  issuerName: string;
  sourceObservedAt: string;
}>;

/**
 * Persists issuer discovery data without granting onchain capabilities.
 * Existing listed/onchain policy fields are preserved; unsafe sessions fail closed.
 */
export async function persistStockQuoteCatalog(
  sql: UnsafeSql,
  schema: string,
  snapshot: StockQuoteCatalogSnapshot,
  records: readonly StockQuoteCatalogRecord[],
): Promise<void> {
  if (!/^zkblast_[a-z0-9_]+$/u.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
  const parsed = records.map((record) => stockQuoteCatalogRecordSchema.parse(record));
  if (parsed.some((record) => record.chainId !== snapshot.chainId)) {
    throw new Error("STOCK_QUOTE_CHAIN_MISMATCH");
  }
  await sql.unsafe(
    `insert into ${schema}.stock_quote_catalog_snapshots(chain_id,source_hash,issuer_name,source_observed_at,asset_count)
     values($1,$2,$3,$4,$5) on conflict(chain_id,source_hash) do nothing`,
    [snapshot.chainId, snapshot.sourceHash.toLowerCase(), snapshot.issuerName, snapshot.sourceObservedAt, parsed.length],
  );
  for (const record of parsed) {
    await sql.unsafe(
      `insert into ${schema}.stock_quote_assets(
         chain_id,contract_address,issuer_asset_id,symbol,instrument_name,issuer_name,token_decimals,
         current_multiplier,pending_multiplier,availability,market_state,quote_trading_enabled,
         graduation_enabled,price_feed_address,max_oracle_age_seconds,source_hash,source_observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,false,null,null,$12,$13)
       on conflict(chain_id,contract_address) do update set
         issuer_asset_id=excluded.issuer_asset_id,symbol=excluded.symbol,instrument_name=excluded.instrument_name,
         issuer_name=excluded.issuer_name,token_decimals=excluded.token_decimals,
         current_multiplier=excluded.current_multiplier,pending_multiplier=excluded.pending_multiplier,
         availability=case when stock_quote_assets.availability='listed' then 'listed' else excluded.availability end,
         market_state=excluded.market_state,
         quote_trading_enabled=case when excluded.market_state in ('halted','degraded','emergency') then false else stock_quote_assets.quote_trading_enabled end,
         source_hash=excluded.source_hash,source_observed_at=excluded.source_observed_at,updated_at=now()`,
      [
        record.chainId,
        record.contractAddress,
        record.issuerAssetId.toLowerCase(),
        record.symbol,
        record.instrumentName,
        record.issuerName,
        record.tokenDecimals,
        record.currentMultiplier,
        record.pendingMultiplier || null,
        record.availability,
        record.marketState,
        record.sourceHash.toLowerCase(),
        record.observedAt,
      ],
    );
  }
}
