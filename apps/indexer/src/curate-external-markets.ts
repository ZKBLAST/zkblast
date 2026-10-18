import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import { z } from "zod";

const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.enum(["zkblast_testnet", "zkblast_mainnet"]),
    MARKET_CURATION_FILE: z.string().default("data/market-curation.json"),
  })
  .parse(process.env);

const recordSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
  region: z.enum(["us", "china"]),
  regionReason: z.string().trim().min(3).max(500),
  candidateLogoUrl: z.string().url().nullable(),
  logoDecision: z.enum(["pending", "approved", "rejected"]),
  logoReason: z.string().trim().min(3).max(500),
});
const fileSchema = z.object({
  version: z.literal(1),
  curator: z.string().trim().min(3).max(100),
  records: z.array(recordSchema).max(2_000),
});
type MarketRow = Readonly<{
  id: string;
  symbol: string;
  contract_address: string;
  market_region: string;
  candidate_logo_url: string | null;
  logo_status: string;
}>;

const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});
const path = resolve(process.cwd(), config.MARKET_CURATION_FILE);
const chinaLinkedSymbols = new Set(["BABA", "FUTU"]);

async function markets() {
  return sql.unsafe<MarketRow[]>(
    `select id,symbol,contract_address,market_region,candidate_logo_url,logo_status
     from ${config.SUPABASE_SCHEMA}.external_markets
     where source='robinhood_stock_token' order by symbol`,
  );
}

async function exportFile() {
  const rows = await markets();
  const file = {
    version: 1 as const,
    curator: "zkblast-owner-review",
    records: rows.map((row) => {
      const chinaLinked = chinaLinkedSymbols.has(row.symbol);
      return {
        symbol: row.symbol,
        contractAddress: row.contract_address,
        region: chinaLinked ? ("china" as const) : ("us" as const),
        regionReason: chinaLinked
          ? "Initial explicit China-linked issuer curation; owner review required."
          : "US-listed market catalog classification; owner review required.",
        candidateLogoUrl: row.candidate_logo_url,
        logoDecision: "pending" as const,
        logoReason: "Awaiting owner visual and URL review.",
      };
    }),
  };
  fileSchema.parse(file);
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(JSON.stringify({ exported: rows.length, path }));
}

function validCandidateLogo(url: string, contractAddress: string) {
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "cdn.robinhood.com" &&
    parsed.pathname ===
      `/ncw_assets/logos/${contractAddress.toLowerCase()}.png` &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash
  );
}

async function applyFile() {
  const input = fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const rows = await markets();
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  if (input.records.length !== rows.length)
    throw new Error(
      "Curation file must contain every current Stock Token once",
    );
  const seen = new Set<string>();
  await sql.begin(async (transaction) => {
    for (const record of input.records) {
      if (seen.has(record.symbol))
        throw new Error(`Duplicate curation symbol: ${record.symbol}`);
      seen.add(record.symbol);
      const row = bySymbol.get(record.symbol);
      if (!row || row.contract_address !== record.contractAddress)
        throw new Error(`Market identity mismatch: ${record.symbol}`);
      if (row.market_region !== record.region) {
        await transaction.unsafe(
          `insert into ${config.SUPABASE_SCHEMA}.external_market_curation_audit
            (market_id,field_name,previous_value,next_value,reason,curator)
           values ($1,'market_region',$2,$3,$4,$5)`,
          [
            row.id,
            row.market_region,
            record.region,
            record.regionReason,
            input.curator,
          ],
        );
      }
      let logoUrl: string | null = null;
      if (record.logoDecision === "approved") {
        if (
          !record.candidateLogoUrl ||
          record.candidateLogoUrl !== row.candidate_logo_url ||
          !validCandidateLogo(record.candidateLogoUrl, record.contractAddress)
        )
          throw new Error(`Unsafe logo candidate: ${record.symbol}`);
        logoUrl = record.candidateLogoUrl;
      }
      if (row.logo_status !== record.logoDecision) {
        await transaction.unsafe(
          `insert into ${config.SUPABASE_SCHEMA}.external_market_curation_audit
            (market_id,field_name,previous_value,next_value,reason,curator)
           values ($1,'logo_status',$2,$3,$4,$5)`,
          [
            row.id,
            row.logo_status,
            record.logoDecision,
            record.logoReason,
            input.curator,
          ],
        );
      }
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.external_markets
         set market_region=$2,logo_status=$3,logo_url=$4,
           logo_validated_at=case when $3='approved' then now() else null end,
           updated_at=now()
         where id=$1`,
        [row.id, record.region, record.logoDecision, logoUrl],
      );
    }
  });
  console.log(JSON.stringify({ applied: input.records.length, path }));
}

try {
  const mode = process.argv[2];
  if (mode === "export") await exportFile();
  else if (mode === "apply") await applyFile();
  else throw new Error("Usage: curate-external-markets.ts export|apply");
} finally {
  await sql.end();
}
