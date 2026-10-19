import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { getAddress } from "viem";

if (process.env.APP_ENV !== "mainnet" || process.env.CHAIN_ID !== "4663")
  throw new Error("Mainnet chain 4663 required");
if (process.env.SUPABASE_SCHEMA !== "zkblast_mainnet")
  throw new Error("Mainnet schema required");
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: true });
const output = path.resolve("data/mainnet-stock-markets.json");
const priority = ["AMD", "AMZN", "NFLX", "PLTR", "TSLA", "MSFT", "META", "GOOGL"];

try {
  const rows = await sql`
    select external_id,contract_address,symbol,name,status,market_region,
           candidate_logo_url,logo_url,logo_status,metadata,validated_at
      from zkblast_testnet.external_markets
     where source='robinhood_stock_token'
       and status='active'
       and contract_address is not null
     order by symbol
  `;
  if (rows.length < 6) throw new Error("Validated stock catalogue is unexpectedly small");

  const seen = new Set();
  const markets = rows.map((row) => {
    const symbol = String(row.symbol).trim().toUpperCase();
    if (seen.has(symbol)) throw new Error(`Duplicate stock symbol: ${symbol}`);
    seen.add(symbol);
    return {
      externalId: String(row.external_id),
      symbol,
      name: String(row.name),
      address: getAddress(String(row.contract_address)),
      logoUrl: row.logo_url ?? row.candidate_logo_url ?? null,
      logoStatus: row.logo_status ?? "pending",
      marketRegion: row.market_region ?? "unclassified",
      metadata: row.metadata ?? {},
      validatedAt: row.validated_at ?? null,
    };
  });
  markets.sort((left, right) => {
    const leftIndex = priority.indexOf(left.symbol);
    const rightIndex = priority.indexOf(right.symbol);
    if (leftIndex >= 0 || rightIndex >= 0)
      return (leftIndex < 0 ? priority.length : leftIndex) -
        (rightIndex < 0 ? priority.length : rightIndex);
    return left.symbol.localeCompare(right.symbol);
  });

  await sql.begin(async (transaction) => {
    for (const market of markets) {
      const existing = await transaction`
        select id from zkblast_mainnet.external_markets
         where source='robinhood_stock_token' and symbol=${market.symbol}
         order by updated_at desc limit 1
      `;
      const metadata = {
        ...market.metadata,
        catalogueSnapshot: true,
        catalogueSourceSchema: "zkblast_testnet",
      };
      if (existing[0]) {
        await transaction`
          update zkblast_mainnet.external_markets
             set contract_address=${market.address.toLowerCase()},name=${market.name},
                 quote_symbol='USDG',status='active',read_only=true,
                 market_region=${market.marketRegion},candidate_logo_url=${market.logoUrl},
                 logo_url=${market.logoUrl},logo_status=${market.logoStatus},
                 logo_validated_at=${market.logoStatus === "approved" ? new Date() : null},
                 metadata=${sql.json(metadata)},validated_at=${market.validatedAt},updated_at=now()
           where id=${existing[0].id}
        `;
      } else {
        await transaction`
          insert into zkblast_mainnet.external_markets
            (source,external_id,chain_id,contract_address,symbol,name,quote_symbol,status,
             read_only,market_region,candidate_logo_url,logo_url,logo_status,logo_validated_at,
             metadata,validated_at)
          values ('robinhood_stock_token',${market.externalId},4663,${market.address.toLowerCase()},
                  ${market.symbol},${market.name},'USDG','active',true,${market.marketRegion},
                  ${market.logoUrl},${market.logoUrl},${market.logoStatus},
                  ${market.logoStatus === "approved" ? new Date() : null},${sql.json(metadata)},
                  ${market.validatedAt})
        `;
      }
    }
  });

  const publicCatalogue = {
    version: 2,
    chainId: 4663,
    quoteSymbol: "USDG",
    generatedAt: new Date().toISOString(),
    source: "validated_database_snapshot",
    markets: markets.map(({ symbol, name, address, logoUrl }) => ({
      symbol,
      name,
      address,
      logoUrl,
    })),
  };
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(publicCatalogue, null, 2)}\n`, {
    mode: 0o644,
  });
  await rename(temporary, output);
  console.log(`Prepared ${markets.length} mainnet stock markets with logo metadata`);
} finally {
  await sql.end();
}
