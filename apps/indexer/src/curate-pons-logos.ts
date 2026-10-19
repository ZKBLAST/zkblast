import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import { z } from "zod";
import { quoteAssetLogos } from "./quote-asset-logos.js";

const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.enum(["zkblast_testnet", "zkblast_mainnet"]),
    PONS_LOGO_CURATION_FILE: z.string().default("data/pons-logo-curation.json"),
  })
  .parse(process.env);

const recordSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
  logoUrl: z.string().url(),
  sourceUrl: z.string().url(),
  reason: z.string().trim().min(10).max(500),
});
const fileSchema = z.object({
  version: z.literal(1),
  curator: z.string().trim().min(3).max(100),
  records: z.array(recordSchema).min(1).max(100),
});
type MarketRow = Readonly<{
  id: string;
  symbol: string;
  contract_address: string;
  logo_status: string;
}>;

const approvedSources = new Map([
  [
    "0xe6864e4630d4d7a0cad2e61f6bc2c0dcad777712",
    {
      sourceUrl: "https://www.hoodlink.run/",
      logoUrl: "https://www.hoodlink.run/favicon.ico",
    },
  ],
  [
    "0x39dbed3a2bd333467115de45665cc57f813c4571",
    {
      sourceUrl: "https://pons.club/",
      logoUrl: "https://pons.club/pons-token.png",
    },
  ],
]);
function hasImageSignature(bytes: Uint8Array) {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const ico = [0, 0, 1, 0];
  return (
    png.every((value, index) => bytes[index] === value) ||
    ico.every((value, index) => bytes[index] === value)
  );
}

async function validateRemoteImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Logo request failed: ${response.status}`);
  const type = response.headers.get("content-type")?.split(";", 1)[0];
  if (
    type !== "image/png" &&
    type !== "image/x-icon" &&
    type !== "image/vnd.microsoft.icon"
  )
    throw new Error(`Unsupported logo content type: ${type ?? "missing"}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 100 ||
    bytes.length > 2_000_000 ||
    !hasImageSignature(bytes)
  )
    throw new Error("Invalid logo file");
}

async function main() {
  const path = resolve(process.cwd(), config.PONS_LOGO_CURATION_FILE);
  const input = fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const seen = new Set<string>();
  for (const record of input.records) {
    if (seen.has(record.contractAddress))
      throw new Error(`Duplicate contract: ${record.contractAddress}`);
    seen.add(record.contractAddress);
    const approved = approvedSources.get(record.contractAddress);
    if (
      !approved ||
      approved.logoUrl !== record.logoUrl ||
      approved.sourceUrl !== record.sourceUrl
    )
      throw new Error(`Unapproved logo source: ${record.symbol}`);
    await validateRemoteImage(record.logoUrl);
  }

  const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: true,
  });
  try {
    await sql.begin(async (transaction) => {
      for (const record of input.records) {
        const rows = await transaction.unsafe<MarketRow[]>(
          `select id,symbol,contract_address,logo_status
           from ${config.SUPABASE_SCHEMA}.external_markets
           where source='pons_graduated' and contract_address=$1 for update`,
          [record.contractAddress],
        );
        const row = rows[0];
        if (!row || row.symbol !== record.symbol)
          throw new Error(`Market identity mismatch: ${record.symbol}`);
        if (row.logo_status !== "approved") {
          await transaction.unsafe(
            `insert into ${config.SUPABASE_SCHEMA}.external_market_curation_audit
              (market_id,field_name,previous_value,next_value,reason,curator)
             values ($1,'logo_status',$2,'approved',$3,$4)`,
            [row.id, row.logo_status, record.reason, input.curator],
          );
        }
        await transaction.unsafe(
          `update ${config.SUPABASE_SCHEMA}.external_markets
           set candidate_logo_url=$2,logo_status='approved',logo_url=$2,
             logo_validated_at=now(),updated_at=now(),
             metadata=metadata || jsonb_build_object(
               'logoSourceUrl',$3::text,
               'quoteLogos',jsonb_build_object('WETH',$4::text)
             )
           where id=$1`,
          [row.id, record.logoUrl, record.sourceUrl, quoteAssetLogos.WETH],
        );
      }
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.external_markets
         set metadata=metadata || jsonb_build_object(
           'quoteLogos',jsonb_build_object('WETH',$1::text)
         ),updated_at=now()
         where source='pons_graduated'`,
        [quoteAssetLogos.WETH],
      );
    });
    console.log(JSON.stringify({ applied: input.records.length, path }));
  } finally {
    await sql.end();
  }
}

await main();
