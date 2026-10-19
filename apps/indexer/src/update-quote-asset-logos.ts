import postgres from "postgres";
import { z } from "zod";

import { quoteAssetLogos } from "./quote-asset-logos.js";

const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.enum(["zkblast_testnet", "zkblast_mainnet"]),
  })
  .parse(process.env);

const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
  ssl: "require",
});

try {
  const result = await sql.begin(async (transaction) => {
    const updated = await transaction.unsafe<{ id: string }[]>(
      `update ${config.SUPABASE_SCHEMA}.external_markets
       set metadata=jsonb_set(
         coalesce(metadata,'{}'::jsonb),
         '{quoteLogos}',
         coalesce(metadata->'quoteLogos','{}'::jsonb) || jsonb_build_object(
           'USDG',$1::text,
           'WETH',$2::text,
           'ETH',$3::text
         ),
         true
       ),updated_at=now()
       returning id`,
      [quoteAssetLogos.USDG, quoteAssetLogos.WETH, quoteAssetLogos.ETH],
    );
    const invalid = await transaction.unsafe<{ count: number }[]>(
      `select count(*)::int as count
       from ${config.SUPABASE_SCHEMA}.external_markets
       where metadata->'quoteLogos'->>'USDG' is distinct from $1
          or metadata->'quoteLogos'->>'WETH' is distinct from $2
          or metadata->'quoteLogos'->>'ETH' is distinct from $3`,
      [quoteAssetLogos.USDG, quoteAssetLogos.WETH, quoteAssetLogos.ETH],
    );
    if (invalid[0]?.count !== 0)
      throw new Error("QUOTE_LOGO_UPDATE_VALIDATION_FAILED");
    return updated.length;
  });
  console.log(
    JSON.stringify({
      schema: config.SUPABASE_SCHEMA,
      updatedMarkets: result,
      symbols: Object.keys(quoteAssetLogos),
    }),
  );
} finally {
  await sql.end();
}
