import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

if (process.env.APP_ENV !== "testnet")
  throw new Error("Testnet environment required");
if (process.env.SUPABASE_SCHEMA !== "zkblast_testnet")
  throw new Error("Testnet schema required");
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
const manifest = JSON.parse(
  await readFile(path.resolve("deployments/testnet/market.json"), "utf8"),
);
if (manifest.protocol !== "ZKBLAST" || manifest.environment !== "testnet")
  throw new Error("Market manifest identity mismatch");
const sql = postgres(databaseUrl, { max: 1, prepare: true });

try {
  await sql.begin(async (transaction) => {
    const assetIds = [];
    for (const token of manifest.tokens) {
      const rows = await transaction`
        insert into zkblast_testnet.assets (chain_id, address, symbol, name, decimals, is_verified)
        values (${manifest.chainId}, ${token.address.toLowerCase()}, ${token.symbol}, ${token.name}, ${token.decimals}, true)
        on conflict (chain_id, address) do update set symbol=excluded.symbol, name=excluded.name, decimals=excluded.decimals, is_verified=true, updated_at=now()
        returning id
      `;
      assetIds.push(rows[0].id);
    }
    await transaction`
      insert into zkblast_testnet.pools (chain_id, address, pool_kind, token_x_id, token_y_id, fee_bps, status, created_block)
      values (${manifest.chainId}, ${manifest.pool.address.toLowerCase()}, ${manifest.pool.model}, ${assetIds[0]}, ${assetIds[1]}, ${manifest.pool.feeBps}, 'active', ${manifest.pool.createdBlock})
      on conflict (chain_id, address) do update set token_x_id=excluded.token_x_id, token_y_id=excluded.token_y_id, fee_bps=excluded.fee_bps, status='active', updated_at=now()
    `;
  });
  console.log("Registered 2 verified testnet assets and 1 active pool");
} finally {
  await sql.end();
}
