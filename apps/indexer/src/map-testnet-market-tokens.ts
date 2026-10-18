import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
} from "viem";
import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => getAddress(value));
const config = z
  .object({
    CHAIN_ID: z.coerce.number().int(),
    RPC_URL: z.string().url(),
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.literal("zkblast_testnet"),
    EXECUTION_WETH_ADDRESS: address,
    EXECUTION_USDG_ADDRESS: address,
    TESTNET_MARKET_MAPPING_FILE: z
      .string()
      .default("data/testnet-market-mappings.json"),
  })
  .parse(process.env);
const fileSchema = z.object({
  version: z.literal(1),
  chainId: z.literal(46630),
  discoverySource: z.string().url(),
  mappings: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(32),
        address,
        decimals: z.number().int().min(0).max(36),
      }),
    )
    .min(1)
    .max(500),
});
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const client = createPublicClient({ transport: http(config.RPC_URL) });
const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});

async function validateToken(
  mapping: Readonly<{ symbol: string; address: Address; decimals: number }>,
) {
  const [bytecode, symbol, decimals, totalSupply] = await Promise.all([
    client.getBytecode({ address: mapping.address }),
    client.readContract({
      address: mapping.address,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: mapping.address,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: mapping.address,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
  ]);
  if (!bytecode || bytecode === "0x")
    throw new Error(`Execution token has no bytecode: ${mapping.symbol}`);
  if (symbol !== mapping.symbol)
    throw new Error(
      `Execution token symbol mismatch: expected ${mapping.symbol}, received ${symbol}`,
    );
  if (decimals !== mapping.decimals)
    throw new Error(`Execution token decimals mismatch: ${mapping.symbol}`);
  if (totalSupply === 0n)
    throw new Error(`Execution token has zero supply: ${mapping.symbol}`);
}

try {
  if (config.CHAIN_ID !== 46630)
    throw new Error("Testnet market mapping requires CHAIN_ID=46630");
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== config.CHAIN_ID)
    throw new Error(
      `RPC chain mismatch: expected 46630, received ${rpcChainId}`,
    );
  const input = fileSchema.parse(
    JSON.parse(
      await readFile(
        resolve(process.cwd(), config.TESTNET_MARKET_MAPPING_FILE),
        "utf8",
      ),
    ),
  );
  const seenSymbols = new Set<string>();
  const seenAddresses = new Set<string>();
  const blockNumber = await client.getBlockNumber();
  await sql.begin(async (transaction) => {
    for (const mapping of input.mappings) {
      const normalizedAddress = mapping.address.toLowerCase();
      if (
        seenSymbols.has(mapping.symbol) ||
        seenAddresses.has(normalizedAddress)
      )
        throw new Error(`Duplicate execution token mapping: ${mapping.symbol}`);
      if (
        normalizedAddress === config.EXECUTION_USDG_ADDRESS.toLowerCase() ||
        normalizedAddress === config.EXECUTION_WETH_ADDRESS.toLowerCase()
      )
        throw new Error(
          `Base token cannot equal quote token: ${mapping.symbol}`,
        );
      seenSymbols.add(mapping.symbol);
      seenAddresses.add(normalizedAddress);
      await validateToken(mapping);
      const rows = await transaction.unsafe<{ id: string }[]>(
        `select id from ${config.SUPABASE_SCHEMA}.external_markets
         where source='robinhood_stock_token' and symbol=$1 and status='active'`,
        [mapping.symbol],
      );
      if (rows.length !== 1)
        throw new Error(
          `Expected one active reference market: ${mapping.symbol}`,
        );
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.external_markets
         set metadata=metadata || $2::jsonb,updated_at=now() where id=$1`,
        [
          rows[0]!.id,
          sql.json({
            executionAddress: normalizedAddress,
            executionChainId: 46630,
            executionDecimals: mapping.decimals,
            executionTokenType: "testnet_faucet_token",
            executionValidatedBlock: blockNumber.toString(),
            executionDiscoverySource: input.discoverySource,
          }),
        ],
      );
    }
  });
  console.log(
    JSON.stringify({
      mapped: input.mappings.length,
      blockNumber: blockNumber.toString(),
    }),
  );
} finally {
  await sql.end();
}
