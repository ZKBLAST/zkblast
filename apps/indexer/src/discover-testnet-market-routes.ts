import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import postgres from "postgres";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
} from "viem";
import { z } from "zod";

const runtime = loadServerConfig(process.env);
const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.literal("zkblast_testnet"),
    ROUTE_DISCOVERY_CHUNK_SIZE: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(10_000),
  })
  .parse(process.env);
if (runtime.CHAIN_ID !== 46630)
  throw new Error("Testnet route discovery requires CHAIN_ID=46630");

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(projectRoot, runtime.DEPLOYMENT_MANIFEST_PATH),
  { environment: "testnet", chainId: 46630 },
);
const factory = getAddress(manifest.integration.poolFactory);
const registry = getAddress(manifest.integration.poolRegistry);
const poolCreated = parseAbiItem(
  "event PoolCreated(bytes32 indexed poolId,address indexed pool,(address token0,address token1,uint8 model,uint24 feePips,uint16 binStepBps) key)",
);
const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function totalShares() view returns (uint256)",
  "function activeBin() view returns (int24)",
  "function binState(int24) view returns (uint128 reserve0,uint128 reserve1,uint256 totalShares,uint256 priceX18)",
]);
const registryAbi = parseAbi([
  "function isRegisteredPool(address pool) view returns (bool)",
]);
const client = createPublicClient({ transport: http(runtime.RPC_URL) });
const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});

type Candidate = Readonly<{
  id: string;
  baseAddress: string;
  quoteAddress: string;
}>;
type Observation = Readonly<{
  pool: Address;
  feePips: number;
  liquidity: bigint;
  model: "damm" | "dlmm";
}>;

function pairKey(addressA: string, addressB: string) {
  return [addressA.toLowerCase(), addressB.toLowerCase()].sort().join(":");
}

async function inspectPool(
  pool: Address,
  expectedModel: number,
  expectedToken0: Address,
  expectedToken1: Address,
): Promise<Observation | null> {
  const [bytecode, registered, poolFactory, token0, token1, feePips] =
    await Promise.all([
      client.getBytecode({ address: pool }),
      client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "isRegisteredPool",
        args: [pool],
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "factory",
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token0",
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token1",
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "feePips",
      }),
    ]);
  if (
    !bytecode ||
    bytecode === "0x" ||
    !registered ||
    poolFactory !== factory ||
    token0 !== expectedToken0 ||
    token1 !== expectedToken1
  )
    return null;
  if (expectedModel === 0) {
    const liquidity = await client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: "totalShares",
    });
    return { pool, feePips, liquidity, model: "damm" };
  }
  const activeBin = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "activeBin",
  });
  const bin = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "binState",
    args: [activeBin],
  });
  return { pool, feePips, liquidity: bin[2], model: "dlmm" };
}

try {
  if ((await client.getChainId()) !== runtime.CHAIN_ID)
    throw new Error("RPC chain does not match configured execution chain");
  const candidates = await sql.unsafe<Candidate[]>(
    `select id,base_address as "baseAddress",quote_address as "quoteAddress"
     from ${config.SUPABASE_SCHEMA}.external_market_pairs
     where execution_chain_id=46630 and base_address is not null
       and route_status <> 'disabled'`,
  );
  const byPair = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = pairKey(candidate.baseAddress, candidate.quoteAddress);
    byPair.set(key, [...(byPair.get(key) ?? []), candidate]);
  }
  const best = new Map<string, Observation>();
  const head = await client.getBlockNumber();
  for (
    let from = BigInt(manifest.deploymentBlock);
    from <= head;
    from += BigInt(config.ROUTE_DISCOVERY_CHUNK_SIZE)
  ) {
    const end = from + BigInt(config.ROUTE_DISCOVERY_CHUNK_SIZE - 1);
    const to = end < head ? end : head;
    const logs = await client.getLogs({
      address: factory,
      event: poolCreated,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const poolKey = log.args.key;
      const poolAddress = log.args.pool;
      if (!poolKey || !poolAddress) continue;
      const key = pairKey(poolKey.token0, poolKey.token1);
      const matched = byPair.get(key);
      if (!matched) continue;
      const observation = await inspectPool(
        getAddress(poolAddress),
        poolKey.model,
        getAddress(poolKey.token0),
        getAddress(poolKey.token1),
      );
      if (!observation) continue;
      for (const candidate of matched) {
        const previous = best.get(candidate.id);
        if (!previous || observation.liquidity > previous.liquidity)
          best.set(candidate.id, observation);
      }
    }
  }
  for (const candidate of candidates) {
    const observation = best.get(candidate.id);
    if (!observation) continue;
    const validated = observation.liquidity > 0n;
    await sql.unsafe(
      `update ${config.SUPABASE_SCHEMA}.external_market_pairs set
         route_status=$2,venue=$3,pool_identifier=$4,fee_tier=$5,
         liquidity_raw=$6,observed_block=$7,observed_at=now(),
         validated_at=case when $2='validated' then now() else null end,
         metadata=metadata || $8::jsonb,updated_at=now()
       where id=$1`,
      [
        candidate.id,
        validated ? "validated" : "observed",
        `zkblast_${observation.model}`,
        observation.pool.toLowerCase(),
        observation.feePips,
        observation.liquidity.toString(),
        head.toString(),
        sql.json({
          discovery: "pool-factory-event-and-registry",
          liquidityUnit: "pool-shares",
        }),
      ],
    );
  }
  console.log(
    JSON.stringify({
      scanned: candidates.length,
      matched: best.size,
      head: head.toString(),
    }),
  );
} finally {
  await sql.end();
}
