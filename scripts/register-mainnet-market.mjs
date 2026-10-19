import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

if (process.env.APP_ENV !== "mainnet")
  throw new Error("Mainnet environment required");
if (process.env.CHAIN_ID !== "4663") throw new Error("Chain 4663 required");
if (process.env.SUPABASE_SCHEMA !== "zkblast_mainnet")
  throw new Error("Mainnet schema required");
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
const rpcUrl = process.env.RPC_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
if (!rpcUrl) throw new Error("RPC_URL is required");

const manifest = JSON.parse(
  await readFile(path.resolve("deployments/mainnet/market.json"), "utf8"),
);
if (
  manifest.protocol !== "ZKBLAST" ||
  manifest.environment !== "mainnet" ||
  manifest.chainId !== 4663
)
  throw new Error("Mainnet market manifest identity mismatch");
if (manifest.pool.liquidityStatus !== "awaiting_initial_liquidity")
  throw new Error("Unexpected mainnet pool liquidity status");

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function reserve0() view returns (uint112)",
  "function reserve1() view returns (uint112)",
  "function totalShares() view returns (uint256)",
]);
const client = createPublicClient({ transport: http(rpcUrl) });
const poolAddress = getAddress(manifest.pool.address);
const [chainId, bytecode, token0, token1, feePips, reserve0, reserve1, shares] =
  await Promise.all([
    client.getChainId(),
    client.getBytecode({ address: poolAddress }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token0",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token1",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "feePips",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "reserve0",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "reserve1",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "totalShares",
    }),
  ]);
if (chainId !== 4663 || !bytecode || bytecode === "0x")
  throw new Error("Mainnet pool runtime validation failed");
if (
  getAddress(token0) !== getAddress(manifest.tokens[0].address) ||
  getAddress(token1) !== getAddress(manifest.tokens[1].address) ||
  Number(feePips) !== manifest.pool.feePips
)
  throw new Error("Mainnet pool configuration mismatch");
if (reserve0 !== 0n || reserve1 !== 0n || shares !== 0n)
  throw new Error("Expected a newly created empty pool");

const sql = postgres(databaseUrl, { max: 1, prepare: true });
try {
  await sql.begin(async (transaction) => {
    const assetIds = [];
    for (const token of manifest.tokens) {
      const rows = await transaction`
        insert into zkblast_mainnet.assets (chain_id, address, symbol, name, decimals, is_verified)
        values (${manifest.chainId}, ${token.address.toLowerCase()}, ${token.symbol}, ${token.name}, ${token.decimals}, true)
        on conflict (chain_id, address) do update set symbol=excluded.symbol, name=excluded.name, decimals=excluded.decimals, is_verified=true, updated_at=now()
        returning id
      `;
      assetIds.push(rows[0].id);
    }
    await transaction`
      insert into zkblast_mainnet.pools (chain_id, address, pool_kind, token_x_id, token_y_id, fee_bps, status, created_block)
      values (${manifest.chainId}, ${poolAddress.toLowerCase()}, ${manifest.pool.model}, ${assetIds[0]}, ${assetIds[1]}, ${manifest.pool.feeBps}, 'active', ${manifest.pool.createdBlock})
      on conflict (chain_id, address) do update set token_x_id=excluded.token_x_id, token_y_id=excluded.token_y_id, fee_bps=excluded.fee_bps, status='active', updated_at=now()
    `;
  });
  console.log(
    "Registered two verified mainnet assets and one validated empty pool",
  );
} finally {
  await sql.end();
}
