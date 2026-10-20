import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
} from "viem";

const CHAIN_ID = 4663;
const ZERO_ADDRESS = getAddress("0x0000000000000000000000000000000000000000");
const QUOTE_LOGOS = {
  USDG: "https://mintcdn.com/paxos-0ac97319/ykAU2vouTvwgGjtD/images/usdg.png?fit=max&auto=format&n=ykAU2vouTvwgGjtD&q=85&s=3a2dfa481556c8322f0271baedb00afe",
  WETH: "https://images.cryptorank.io/coins/weth1701090834118.png",
  ETH: "https://metamask.io/_next/image?url=https%3A%2F%2Fpolymarket-upload.s3.us-east-2.amazonaws.com%2FETH%2Bfullsize.jpg&w=640&q=75",
  NVDA: "https://api.eulerpool.com/api/1/logo/ticker/NVDA",
  SPY: "https://api.eulerpool.com/api/1/logo/ticker/SPY",
};
const ZKBLAST_TARGET_QUOTE_BY_SOURCE = {
  ETH: "ETH",
  NVDA: "USDG",
  SPY: "USDG",
  USDG: "USDG",
  WETH: "WETH",
};
const CONFIRMATION = "IMPORT_ZKBLAST_MAINNET_PONS_TRENDING";
const sourcePath = path.resolve("data/mainnet-pons-trending.json");
const evidencePath = path.resolve("data/mainnet-pons-trending.validated.json");
const catalogue = JSON.parse(await readFile(sourcePath, "utf8"));

if (process.env.APP_ENV !== "mainnet" || Number(process.env.CHAIN_ID) !== CHAIN_ID)
  throw new Error("Mainnet chain 4663 required");
if (process.env.SUPABASE_SCHEMA !== "zkblast_mainnet")
  throw new Error("Mainnet schema required");
if (catalogue.chainId !== CHAIN_ID || catalogue.markets.length !== 10)
  throw new Error("Pons trending catalogue mismatch");

const rpcUrl = process.env.PONS_RPC_URL?.trim() || process.env.RPC_URL?.trim();
if (!rpcUrl) throw new Error("PONS_RPC_URL or RPC_URL is required");
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== CHAIN_ID) throw new Error("RPC chain mismatch");

const executionQuotes = {
  ETH: ZERO_ADDRESS,
  WETH: getAddress(process.env.EXECUTION_WETH_ADDRESS?.trim() ?? ""),
  USDG: getAddress(process.env.EXECUTION_USDG_ADDRESS?.trim() ?? ""),
};

const v1Factories = [
  getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB"),
  getAddress("0x0c37a24F5D23A486FA692d1500881d698B1F77a4"),
];
const v2Factory = getAddress("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
const v1FactoryAbi = parseAbi([
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal,uint256 threshold,bool graduated)",
]);
const v2FactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function liquidityPool() view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

for (const [expectedSymbol, address] of Object.entries(executionQuotes).filter(
  ([symbol]) => symbol !== "ETH",
)) {
  const [code, symbol] = await Promise.all([
    client.getBytecode({ address }),
    client.readContract({ address, abi: tokenAbi, functionName: "symbol" }),
  ]);
  if (!code || code === "0x" || symbol !== expectedSymbol)
    throw new Error(`Invalid ${expectedSymbol} execution token at ${address}`);
}

async function validateLogo(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Logo returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Invalid logo type ${contentType}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 32 || bytes.length > 5_000_000)
    throw new Error(`Invalid logo size ${bytes.length}`);
  return { contentType, bytes: bytes.length };
}

async function validateV1(token) {
  const pool = getAddress(
    await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "liquidityPool",
    }),
  );
  const [token0, token1] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
  ]);
  const normalized = [getAddress(token0), getAddress(token1)];
  if (!normalized.some((address) => address === token))
    throw new Error(`V1 pool does not contain ${token}`);
  const quoteAddress = normalized.find((address) => address !== token);
  if (!quoteAddress) throw new Error(`V1 quote missing for ${token}`);
  for (const factory of v1Factories) {
    try {
      const graduation = await client.readContract({
        address: factory,
        abi: v1FactoryAbi,
        functionName: "graduationStatus",
        args: [token],
      });
      if (graduation[2] && graduation[1] > 0n)
        return {
          factory,
          poolIdentifier: pool,
          quoteAddress,
          pairedPrincipalRaw: graduation[0].toString(),
          graduationThresholdRaw: graduation[1].toString(),
          venue: "pons_uniswap_v3",
        };
    } catch {
      // Continue to the other known V1 factory.
    }
  }
  throw new Error(`No graduated V1 factory record for ${token}`);
}

async function validateV2(token) {
  const launch = await client.readContract({
    address: v2Factory,
    abi: v2FactoryAbi,
    functionName: "getLaunchedToken",
    args: [token],
  });
  if (!launch.exists || launch.phase !== 2 || launch.graduationThreshold <= 0n)
    throw new Error(`Token ${token} is not a graduated V2 launch`);
  return {
    factory: v2Factory,
    poolIdentifier: `v4:${token.toLowerCase()}:${launch.pairToken.toLowerCase()}:${launch.tickSpacing}:0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`,
    quoteAddress: getAddress(launch.pairToken),
    pairedPrincipalRaw: launch.graduationThreshold.toString(),
    graduationThresholdRaw: launch.graduationThreshold.toString(),
    venue: "pons_uniswap_v4",
  };
}

const seen = new Set();
const validated = [];
for (const definition of catalogue.markets) {
  const token = getAddress(definition.tokenAddress);
  if (seen.has(token)) throw new Error(`Duplicate token ${token}`);
  seen.add(token);
  if (Number(definition.marketCapUsd) <= catalogue.minimumMarketCapUsdExclusive)
    throw new Error(`${definition.symbol} is below the market-cap threshold`);
  const [code, name, symbol, decimals, totalSupply, logo] = await Promise.all([
    client.getBytecode({ address: token }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "decimals" }),
    client.readContract({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
    validateLogo(definition.logoUrl),
  ]);
  if (!code || code === "0x" || totalSupply <= 0n)
    throw new Error(`${definition.symbol} has invalid runtime or supply`);
  if (symbol !== definition.symbol || name.trim().length === 0)
    throw new Error(`${definition.symbol} metadata mismatch`);
  const launch =
    definition.generation === "v1"
      ? await validateV1(token)
      : await validateV2(token);
  const quoteSymbol =
    launch.quoteAddress === ZERO_ADDRESS
      ? "ETH"
      : await client.readContract({
          address: launch.quoteAddress,
          abi: tokenAbi,
          functionName: "symbol",
        });
  const targetQuoteSymbol = ZKBLAST_TARGET_QUOTE_BY_SOURCE[quoteSymbol];
  if (!targetQuoteSymbol)
    throw new Error(`${definition.symbol} has unsupported quote ${quoteSymbol}`);
  validated.push({
    ...definition,
    tokenAddress: token,
    name,
    decimals,
    totalSupplyRaw: totalSupply.toString(),
    quoteAddress: launch.quoteAddress,
    quoteSymbol,
    targetQuoteAddress: executionQuotes[targetQuoteSymbol],
    targetQuoteSymbol,
    factoryAddress: launch.factory,
    poolIdentifier: launch.poolIdentifier,
    pairedPrincipalRaw: launch.pairedPrincipalRaw,
    graduationThresholdRaw: launch.graduationThresholdRaw,
    venue: launch.venue,
    logo,
  });
  console.log(
    `${definition.rank}. ${symbol}/${quoteSymbol}: validated; ZKBLAST target ${symbol}/${targetQuoteSymbol}`,
  );
}

await mkdir(path.dirname(evidencePath), { recursive: true });
const temporary = `${evidencePath}.tmp`;
await writeFile(
  temporary,
  `${JSON.stringify({ ...catalogue, validatedAt: new Date().toISOString(), markets: validated }, null, 2)}\n`,
  { mode: 0o644 },
);
await rename(temporary, evidencePath);

if (process.env.CONFIRM_MAINNET_PONS_TRENDING !== CONFIRMATION) {
  console.log(`Validated ${validated.length} markets without database writes`);
  console.log(`Set CONFIRM_MAINNET_PONS_TRENDING=${CONFIRMATION} to import`);
  process.exit(0);
}

const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 15,
  idle_timeout: 10,
});
try {
  await sql.begin(async (transaction) => {
    for (const market of validated) {
      const metadata = {
        trendingRank: market.rank,
        trendingCapturedAt: catalogue.capturedAt,
        sourceUrl: market.sourceUrl,
        generation: market.generation,
        factoryAddress: market.factoryAddress,
        poolIdentifier: market.poolIdentifier,
        sourceQuoteAddress: market.quoteAddress,
        sourceQuoteSymbol: market.quoteSymbol,
        quoteNetwork:
          market.quoteSymbol === "ETH"
            ? { chainId: CHAIN_ID, name: "Robinhood Chain", assetKind: "native" }
            : null,
        quoteLogos: {
          [market.quoteSymbol]: QUOTE_LOGOS[market.quoteSymbol] ?? null,
          [market.targetQuoteSymbol]: QUOTE_LOGOS[market.targetQuoteSymbol] ?? null,
        },
        zkblastTargetQuoteAddress: market.targetQuoteAddress,
        zkblastTargetQuoteSymbol: market.targetQuoteSymbol,
        pairedPrincipalRaw: market.pairedPrincipalRaw,
        graduationThresholdRaw: market.graduationThresholdRaw,
        executionAddress: market.tokenAddress,
        executionChainId: CHAIN_ID,
        executionDecimals: market.decimals,
      };
      const rows = await transaction`
        insert into zkblast_mainnet.external_markets
          (source,external_id,chain_id,execution_chain_id,contract_address,symbol,name,
           quote_symbol,status,read_only,market_region,market_cap_usd,market_cap_observed_at,
           candidate_logo_url,logo_url,logo_status,logo_validated_at,metadata,validated_at)
        values ('pons_graduated',${market.tokenAddress.toLowerCase()},4663,4663,
                ${market.tokenAddress.toLowerCase()},${market.symbol},${market.name},
                ${market.targetQuoteSymbol},'active',true,'crypto',${market.marketCapUsd},
                ${new Date(catalogue.capturedAt)},${market.logoUrl},${market.logoUrl},
                'approved',now(),${sql.json(metadata)},now())
        on conflict (source,external_id) do update set
          execution_chain_id=4663,contract_address=excluded.contract_address,
          symbol=excluded.symbol,name=excluded.name,quote_symbol=excluded.quote_symbol,
          status='active',read_only=true,market_region='crypto',
          market_cap_usd=excluded.market_cap_usd,
          market_cap_observed_at=excluded.market_cap_observed_at,
          candidate_logo_url=excluded.candidate_logo_url,logo_url=excluded.logo_url,
          logo_status='approved',logo_validated_at=now(),metadata=excluded.metadata,
          validated_at=now(),updated_at=now()
        returning id
      `;
      if (["WETH", "USDG"].includes(market.quoteSymbol)) {
        await transaction`
          insert into zkblast_mainnet.external_market_pairs
            (market_id,data_chain_id,execution_chain_id,base_address,quote_symbol,
             quote_address,priority,route_status,venue,pool_identifier,metadata)
          values (${rows[0].id},4663,4663,${market.tokenAddress.toLowerCase()},
                  ${market.quoteSymbol},${market.quoteAddress.toLowerCase()},1,'observed',
                  ${market.venue},${market.poolIdentifier},
                  ${sql.json({
                    provenance: "pons_launchpad_graduated_pool",
                    ...(market.quoteSymbol === "ETH"
                      ? {
                          nativeAsset: {
                            chainId: CHAIN_ID,
                            network: "Robinhood Chain",
                            symbol: "ETH",
                          },
                        }
                      : {}),
                  })})
          on conflict (market_id,priority) do update set
            execution_chain_id=4663,base_address=excluded.base_address,
            quote_symbol=excluded.quote_symbol,quote_address=excluded.quote_address,
            route_status='observed',venue=excluded.venue,
            pool_identifier=excluded.pool_identifier,metadata=excluded.metadata,
            updated_at=now()
        `;
      }
      if (market.targetQuoteAddress !== market.quoteAddress) {
        await transaction`
          insert into zkblast_mainnet.external_market_pairs
            (market_id,data_chain_id,execution_chain_id,base_address,quote_symbol,
             quote_address,priority,route_status,venue,pool_identifier,metadata)
          values (${rows[0].id},4663,4663,${market.tokenAddress.toLowerCase()},
                  ${market.targetQuoteSymbol},${market.targetQuoteAddress.toLowerCase()},
                  2,'planned',null,null,
                  ${sql.json({
                    preference: "zkblast-mainnet-target",
                    sourcePair: market.quoteSymbol,
                  })})
          on conflict (market_id,quote_address) do update set
            execution_chain_id=4663,base_address=excluded.base_address,
            quote_symbol=excluded.quote_symbol,priority=2,route_status='planned',
            venue=null,pool_identifier=null,metadata=excluded.metadata,updated_at=now()
        `;
      }
      if (market.quoteSymbol === "ETH") {
        await transaction`
          delete from zkblast_mainnet.external_market_pairs
          where market_id=${rows[0].id}
            and (
              quote_symbol='ETH'
              or (
                quote_symbol='WETH'
                and route_status='planned'
                and metadata->>'preference'='zkblast-mainnet-target'
                and metadata->>'sourcePair'='ETH'
              )
            )
        `;
      }
    }
  });
  const importedPairs = await sql`
    select m.symbol,m.quote_symbol as "catalogQuote",p.quote_symbol as "pairQuote",
           p.priority,p.route_status as "routeStatus"
    from zkblast_mainnet.external_markets m
    left join zkblast_mainnet.external_market_pairs p on p.market_id=m.id
    where m.source='pons_graduated'
      and m.metadata->>'trendingCapturedAt'=${catalogue.capturedAt}
    order by (m.metadata->>'trendingRank')::integer,p.priority
  `;
  const nativeEthSymbols = new Set(["RAETO", "HYDX", "PARE", "HARMONIC"]);
  for (const symbol of nativeEthSymbols) {
    const pairs = importedPairs.filter((pair) => pair.symbol === symbol);
    if (
      !pairs.some((pair) => pair.catalogQuote === "ETH") ||
      pairs.some((pair) => pair.pairQuote === "WETH")
    )
      throw new Error(`${symbol} native ETH pair verification failed`);
  }
  console.log(
    importedPairs
      .map(
        (pair) =>
          `${pair.symbol}/${pair.pairQuote ?? pair.catalogQuote} (${pair.routeStatus ?? "catalogue"})`,
      )
      .join(", "),
  );
  console.log(`Imported ${validated.length} Pons trending markets into zkblast_mainnet`);
} finally {
  await sql.end();
}
