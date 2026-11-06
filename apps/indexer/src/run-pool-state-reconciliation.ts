import { loadServerConfig } from "@zkblast/config";
import postgres from "postgres";
import { createPublicClient, http } from "viem";

import { reconcilePoolState } from "./reconcile-pool-state.js";

const config = loadServerConfig(process.env);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL_REQUIRED");

const sql = postgres(databaseUrl, { ssl: "require", max: 1, prepare: false });
const client = createPublicClient({
  transport: http(config.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});

try {
  const result = await reconcilePoolState({
    client,
    sql,
    schema: config.SUPABASE_SCHEMA,
    chainId: config.CHAIN_ID,
  });
  console.log(JSON.stringify({
    environment: config.APP_ENV,
    chainId: config.CHAIN_ID,
    schema: config.SUPABASE_SCHEMA,
    ...result,
  }, null, 2));
} finally {
  await sql.end();
}
