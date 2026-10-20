import { erc20Abi } from "@zkblast/abi";
import type postgres from "postgres";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  getAddress,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { z } from "zod";

const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function binStepBps() view returns (uint16)",
]);
const registryAbi = parseAbi([
  "function isRegisteredPool(address) view returns (bool)",
]);
const metadata = z.object({
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(128),
  decimals: z.number().int().min(0).max(36),
});

/** Repair catalogue/protocol-table drift only from canonical Factory creation evidence. */
export async function syncRegisteredPoolRecords(input: {
  client: PublicClient;
  sql: postgres.Sql;
  schema: string;
  chainId: number;
  factory: Address;
  registry: Address;
}) {
  const { client, sql, schema, chainId, factory, registry } = input;
  if (
    !/^zkblast_(testnet|mainnet)$/u.test(schema) ||
    (await client.getChainId()) !== chainId
  )
    throw new Error("POOL_MAPPING_CHAIN_MISMATCH");
  const creations = await sql.unsafe<
    {
      payload: Record<string, unknown>;
      block_number: string;
      block_hash: string;
    }[]
  >(
    `select case when jsonb_typeof(payload)='string' then (payload#>>'{}')::jsonb else payload end as payload,
      block_number::text,block_hash from ${schema}.protocol_events where chain_id=$1 and contract_address=$2 and event_name='PoolCreated' and canonical order by block_number`,
    [chainId, factory.toLowerCase()],
  );
  let added = 0;
  for (const creation of creations) {
    if (typeof creation.payload.pool !== "string") continue;
    const address = getAddress(creation.payload.pool);
    const existing = await sql.unsafe(
      `select id from ${schema}.pools where chain_id=$1 and address=$2`,
      [chainId, address.toLowerCase()],
    );
    if (existing.length) continue;
    const block = await client.getBlock({
      blockNumber: BigInt(creation.block_number),
    });
    if (block.hash?.toLowerCase() !== creation.block_hash)
      throw new Error("POOL_CREATION_REORG");
    const registered = await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "isRegisteredPool",
      args: [address],
    });
    const [creator, token0, token1, fee] = await Promise.all([
      client.readContract({ address, abi: poolAbi, functionName: "factory" }),
      client.readContract({ address, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address, abi: poolAbi, functionName: "token1" }),
      client.readContract({ address, abi: poolAbi, functionName: "feePips" }),
    ]);
    if (
      !registered ||
      creator.toLowerCase() !== factory.toLowerCase() ||
      token0 === token1 ||
      fee <= 0 ||
      fee >= 1000000 ||
      fee % 100 !== 0
    )
      throw new Error("POOL_MAPPING_METADATA_MISMATCH");
    const step = await client
      .readContract({ address, abi: poolAbi, functionName: "binStepBps" })
      .catch((error: unknown) => {
        if (
          error instanceof BaseError &&
          error.walk(
            (cause) =>
              cause instanceof ContractFunctionRevertedError ||
              cause instanceof ContractFunctionZeroDataError,
          )
        )
          return null;
        throw error;
      });
    if (step !== null && step <= 0) throw new Error("INVALID_DLMM_BIN_STEP");
    const kind = step === null ? "damm" : "dlmm";
    const pairs = await sql.unsafe<
      { base_address: string; quote_address: string; venue: string }[]
    >(
      `select base_address,quote_address,venue from ${schema}.external_market_pairs where execution_chain_id=$1 and lower(pool_identifier)=$2 and route_status='validated'`,
      [chainId, address.toLowerCase()],
    );
    const pair = pairs[0];
    if (
      pair &&
      (!new Set([token0.toLowerCase(), token1.toLowerCase()]).has(
        pair.base_address,
      ) ||
        !new Set([token0.toLowerCase(), token1.toLowerCase()]).has(
          pair.quote_address,
        ) ||
        pair.base_address === pair.quote_address ||
        pair.venue !== `zkblast_${kind}`)
    )
      throw new Error("POOL_ROUTE_IDENTITY_MISMATCH");
    const tokens: (z.infer<typeof metadata> & { address: string })[] = [];
    for (const token of [token0, token1]) {
      const [code, symbol, name, decimals] = await Promise.all([
        client.getBytecode({ address: token }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "name",
        }),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      if (!code || code === "0x") throw new Error("POOL_TOKEN_CODE_MISSING");
      tokens.push({
        address: token.toLowerCase(),
        ...metadata.parse({ symbol, name, decimals }),
      });
    }
    await sql.begin(async (tx) => {
      const ids = new Map<string, string>();
      for (const token of tokens) {
        const rows = await tx.unsafe<{ id: string; decimals: number }[]>(
          `insert into ${schema}.assets (chain_id,address,symbol,name,decimals,is_verified)
          values ($1,$2,$3,$4,$5,false) on conflict (chain_id,address) do update set address=excluded.address returning id,decimals`,
          [chainId, token.address, token.symbol, token.name, token.decimals],
        );
        if (rows[0]?.decimals !== token.decimals)
          throw new Error("POOL_TOKEN_DECIMALS_MISMATCH");
        ids.set(token.address, rows[0].id);
      }
      const base = pair?.base_address ?? token0.toLowerCase();
      const quote =
        base === token0.toLowerCase()
          ? token1.toLowerCase()
          : token0.toLowerCase();
      await tx.unsafe(
        `insert into ${schema}.pools (chain_id,address,pool_kind,token_x_id,token_y_id,fee_bps,created_block,created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (chain_id,address) do nothing`,
        [
          chainId,
          address.toLowerCase(),
          kind,
          ids.get(base)!,
          ids.get(quote)!,
          fee / 100,
          creation.block_number,
          new Date(Number(block.timestamp) * 1000),
        ],
      );
    });
    added++;
  }
  return { added };
}
