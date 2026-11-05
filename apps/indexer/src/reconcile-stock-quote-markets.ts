import type { StockQuoteCatalogRecord } from "@zkblast/database";

type UnsafeSql = Readonly<{
  unsafe(query: string, parameters?: readonly unknown[]): Promise<unknown>;
}>;

type ExternalStockMarket = Readonly<{
  external_id: string;
  contract_address: string;
  symbol: string;
  name: string;
  status: string;
}>;

/**
 * Matches issuer catalog records to display-market rows by immutable issuer ID and address.
 * A legacy `mainnet:<address>` bootstrap identity may be promoted to the issuer ID only
 * when the exact contract address matches. Symbols and names never authorize promotion.
 */
export async function reconcileStockQuoteExternalMarkets(
  sql: UnsafeSql,
  schema: string,
  records: readonly StockQuoteCatalogRecord[],
): Promise<void> {
  if (!/^zkblast_[a-z0-9_]+$/u.test(schema)) {
    throw new Error("INVALID_DATABASE_SCHEMA");
  }
  for (const record of records) {
    let result = await sql.unsafe(
      `select external_id,contract_address,symbol,name,status
       from ${schema}.external_markets
       where source='robinhood_stock_token'
         and lower(external_id)=lower($1)
       order by updated_at desc limit 2`,
      [record.issuerAssetId],
    );
    let rows = result as ExternalStockMarket[];
    if (rows.length === 0) {
      result = await sql.unsafe(
        `select external_id,contract_address,symbol,name,status
         from ${schema}.external_markets
         where source='robinhood_stock_token'
           and lower(contract_address)=lower($1)
         order by updated_at desc limit 2`,
        [record.contractAddress],
      );
      rows = result as ExternalStockMarket[];
      if (rows.length === 0) throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_MISSING");
      if (rows.length !== 1) throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_DUPLICATE");
      const bootstrap = rows[0]!;
      const expectedBootstrapId = `mainnet:${record.contractAddress.toLowerCase()}`;
      if (bootstrap.external_id.toLowerCase() !== expectedBootstrapId) {
        throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_ISSUER_ID_MISMATCH");
      }
      await sql.unsafe(
        `update ${schema}.external_markets
         set external_id=$3::text,
             metadata=metadata || jsonb_build_object('issuerAssetId',$3::text),
             updated_at=now()
         where source='robinhood_stock_token' and lower(contract_address)=lower($1)
           and lower(external_id)=lower($2)`,
        [record.contractAddress, expectedBootstrapId, record.issuerAssetId],
      );
      rows = [{ ...bootstrap, external_id: record.issuerAssetId }];
    }
    if (rows.length !== 1) throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_DUPLICATE");
    const market = rows[0]!;
    if (
      market.contract_address.toLowerCase() !== record.contractAddress.toLowerCase()
    ) {
      throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_ADDRESS_MISMATCH");
    }
    if (market.symbol.toUpperCase() !== record.symbol.toUpperCase()) {
      throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_SYMBOL_MISMATCH");
    }
    if (
      (market.status === "halted" && record.marketState !== "halted") ||
      (market.status === "inactive" && record.availability !== "suspended")
    ) {
      throw new Error("STOCK_QUOTE_EXTERNAL_MARKET_STATUS_MISMATCH");
    }
  }
}
