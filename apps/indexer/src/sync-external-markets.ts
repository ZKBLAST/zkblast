import {
  ponsGraduatedMarketSchema,
  stockAssetResponseSchema,
  stockQuoteResponseSchema,
} from "@zkblast/database";
import postgres from "postgres";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
  type Address,
} from "viem";
import { z } from "zod";

const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.enum(["zkblast_testnet", "zkblast_mainnet"]),
    PONS_RPC_URL: z
      .string()
      .url()
      .default("https://rpc.mainnet.chain.robinhood.com"),
    PONS_LOG_CHUNK_SIZE: z.coerce
      .number()
      .int()
      .min(100)
      .max(100_000)
      .default(25_000),
    PONS_SYNC_MAX_BLOCKS: z.coerce
      .number()
      .int()
      .min(1)
      .max(2_000_000)
      .default(250_000),
    STOCK_TOKEN_API_URL: z
      .string()
      .url()
      .default("https://api.robinhood.com/rhj"),
    STOCK_SYNC_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  })
  .parse(process.env);

const factories = [
  {
    version: "v1-active",
    address: getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB"),
    startBlock: 8_991_118n,
  },
  {
    version: "v1-legacy",
    address: getAddress("0x0c37a24F5D23A486FA692d1500881d698B1F77a4"),
    startBlock: 8_600_612n,
  },
] as const;
const v2Factory = {
  version: "v2",
  address: getAddress("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"),
  startBlock: 91_500_000n,
} as const;

const v1Launch = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)",
);
const v2Launch = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
const v1FactoryAbi = parseAbi([
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)",
]);
const v2FactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function liquidityPool() view returns (address)",
]);

const client = createPublicClient({ transport: http(config.PONS_RPC_URL) });
const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});

async function tokenMetadata(token: Address, includeV1Pool: boolean) {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "name",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "decimals",
    }),
  ]);
  const pool = includeV1Pool
    ? await client.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "liquidityPool",
      })
    : undefined;
  return { name, symbol, decimals, pool };
}

async function upsertPons(
  record: z.infer<typeof ponsGraduatedMarketSchema>,
  version: string,
) {
  await sql.unsafe(
    `insert into ${config.SUPABASE_SCHEMA}.external_markets
      (source,external_id,chain_id,contract_address,symbol,name,quote_symbol,status,read_only,market_region,logo_status,metadata,validated_at)
     values ('pons_graduated',$1,4663,$1,$2,$3,'WETH','active',true,'crypto','missing',$4::jsonb,now())
     on conflict (source,external_id) do update set symbol=excluded.symbol,name=excluded.name,status=excluded.status,metadata=${config.SUPABASE_SCHEMA}.external_markets.metadata || excluded.metadata,validated_at=excluded.validated_at,updated_at=now()`,
    [
      record.tokenAddress,
      record.symbol,
      record.name,
      {
        version,
        factoryAddress: record.factoryAddress,
        poolIdentifier: record.poolIdentifier,
        quoteAddress: record.quoteAddress,
        pairedPrincipalRaw: record.pairedPrincipalRaw,
        graduationThresholdRaw: record.graduationThresholdRaw,
        observedBlock: record.observedBlock,
      },
    ],
  );
}

async function scanRange(consumer: string, startBlock: bigint, latest: bigint) {
  const rows = await sql.unsafe<{ last_processed_block: string }[]>(
    `select last_processed_block::text from ${config.SUPABASE_SCHEMA}.ingestion_checkpoints where consumer=$1 and chain_id=4663`,
    [consumer],
  );
  const from = rows[0] ? BigInt(rows[0].last_processed_block) + 1n : startBlock;
  const maximumEnd = from + BigInt(config.PONS_SYNC_MAX_BLOCKS) - 1n;
  return { from, to: maximumEnd < latest ? maximumEnd : latest };
}

async function saveCheckpoint(consumer: string, blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber });
  if (!block.hash)
    throw new Error(`Missing canonical hash for block ${blockNumber}`);
  await sql.unsafe(
    `insert into ${config.SUPABASE_SCHEMA}.ingestion_checkpoints
      (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block)
     values ($1,4663,$2,$3,$2)
     on conflict (consumer,chain_id) do update set last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,finalized_block=excluded.finalized_block,updated_at=now()`,
    [consumer, blockNumber.toString(), block.hash.toLowerCase()],
  );
}

async function syncV1Factory(
  factory: (typeof factories)[number],
  latest: bigint,
) {
  const consumer = `external-pons-${factory.version}`;
  const { from: start, to: end } = await scanRange(
    consumer,
    factory.startBlock,
    latest,
  );
  if (start > latest) return 0;
  let accepted = 0;
  for (
    let from = start;
    from <= end;
    from += BigInt(config.PONS_LOG_CHUNK_SIZE)
  ) {
    const to =
      from + BigInt(config.PONS_LOG_CHUNK_SIZE - 1) > end
        ? end
        : from + BigInt(config.PONS_LOG_CHUNK_SIZE - 1);
    const logs = await client.getLogs({
      address: factory.address,
      event: v1Launch,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const token = getAddress(log.args.token!);
      const [graduation, metadata] = await Promise.all([
        client.readContract({
          address: factory.address,
          abi: v1FactoryAbi,
          functionName: "graduationStatus",
          args: [token],
        }),
        tokenMetadata(token, true),
      ]);
      if (!graduation[2]) continue;
      const record = ponsGraduatedMarketSchema.parse({
        chainId: 4663,
        factoryAddress: factory.address,
        tokenAddress: token,
        poolIdentifier: metadata.pool,
        quoteAddress: log.args.pairToken,
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        pairedPrincipalRaw: graduation[0].toString(),
        graduationThresholdRaw: graduation[1].toString(),
        graduated: true,
        observedBlock: Number(latest),
      });
      await upsertPons(record, factory.version);
      accepted += 1;
    }
  }
  await saveCheckpoint(consumer, end);
  return accepted;
}

async function syncV2(latest: bigint) {
  const consumer = "external-pons-v2";
  const { from, to } = await scanRange(consumer, v2Factory.startBlock, latest);
  if (from > latest) return 0;
  const logs = await client.getLogs({
    address: v2Factory.address,
    event: v2Launch,
    fromBlock: from,
    toBlock: to,
  });
  let accepted = 0;
  for (const log of logs) {
    const token = getAddress(log.args.token!);
    const [launch, metadata] = await Promise.all([
      client.readContract({
        address: v2Factory.address,
        abi: v2FactoryAbi,
        functionName: "getLaunchedToken",
        args: [token],
      }),
      tokenMetadata(token, false),
    ]);
    if (!launch.exists || launch.phase !== 2) continue;
    const record = ponsGraduatedMarketSchema.parse({
      chainId: 4663,
      factoryAddress: v2Factory.address,
      tokenAddress: token,
      poolIdentifier: `v4:${token.toLowerCase()}:${launch.pairToken.toLowerCase()}:${launch.tickSpacing}:0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`,
      quoteAddress: launch.pairToken,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      pairedPrincipalRaw: launch.graduationThreshold.toString(),
      graduationThresholdRaw: launch.graduationThreshold.toString(),
      graduated: true,
      observedBlock: Number(latest),
    });
    await upsertPons(record, v2Factory.version);
    accepted += 1;
  }
  await saveCheckpoint(consumer, to);
  return accepted;
}

async function syncStocks() {
  const base = config.STOCK_TOKEN_API_URL.replace(/\/$/u, "");
  const assetsResponse = await fetch(`${base}/assets`);
  if (!assetsResponse.ok)
    throw new Error(`Stock assets request failed: ${assetsResponse.status}`);
  const assets = stockAssetResponseSchema
    .parse(await assetsResponse.json())
    .assets.filter((asset) => asset.status === "ASSET_STATUS_ACTIVE")
    .slice(0, config.STOCK_SYNC_LIMIT);
  let accepted = 0;
  for (const asset of assets) {
    const quoteResponse = await fetch(
      `${base}/prices/${encodeURIComponent(asset.tokenSymbol)}`,
    );
    if (!quoteResponse.ok) continue;
    const quote = stockQuoteResponseSchema.parse(await quoteResponse.json())
      .quotes[0];
    if (!quote || quote.tokenSymbol !== asset.tokenSymbol) continue;
    const deployment = asset.deployments.find((item) => item.chainId === 4663)!;
    const status = quote.isTradingHalt ? "halted" : "active";
    const metadata = {
      currentMultiplier: asset.currentMultiplier,
      pendingMultiplier: asset.pendingMultiplier,
      logoUrl: asset.logoUrl,
    };
    const rows = await sql.unsafe<{ id: string }[]>(
      `insert into ${config.SUPABASE_SCHEMA}.external_markets
        (source,external_id,chain_id,contract_address,symbol,name,quote_symbol,status,read_only,market_region,candidate_logo_url,logo_status,metadata,validated_at)
       values ('robinhood_stock_token',$1,4663,$2,$3,$4,'USD',$5,true,'unclassified',$6,'pending',$7::jsonb,$8)
       on conflict (source,external_id) do update set contract_address=excluded.contract_address,symbol=excluded.symbol,name=excluded.name,status=excluded.status,candidate_logo_url=excluded.candidate_logo_url,metadata=${config.SUPABASE_SCHEMA}.external_markets.metadata || excluded.metadata,validated_at=excluded.validated_at,updated_at=now()
       returning id`,
      [
        asset.id,
        deployment.contractAddress,
        asset.tokenSymbol,
        asset.tokenName,
        status,
        asset.logoUrl,
        metadata,
        quote.generatedAt,
      ],
    );
    const sourceHash = keccak256(stringToHex(JSON.stringify(quote)));
    await sql.unsafe(
      `insert into ${config.SUPABASE_SCHEMA}.external_market_quotes
        (market_id,observed_at,bid,ask,currency,daily_volume,source_hash)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (market_id,observed_at) do nothing`,
      [
        rows[0]!.id,
        quote.generatedAt,
        quote.bid,
        quote.ask,
        quote.currency,
        quote.dailyTradingVolume,
        sourceHash,
      ],
    );
    const referencePrice = (Number(quote.bid) + Number(quote.ask)) / 2;
    if (Number.isFinite(referencePrice) && referencePrice > 0) {
      await sql.unsafe(
        `insert into ${config.SUPABASE_SCHEMA}.external_market_price_points
          (market_id,source,observed_at,price,volume,source_hash)
         values ($1,'reference',$2,$3,$4,$5)
         on conflict (market_id,source,observed_at,source_hash) do nothing`,
        [
          rows[0]!.id,
          quote.generatedAt,
          referencePrice.toString(),
          quote.dailyTradingVolume,
          sourceHash,
        ],
      );
    }
    accepted += 1;
  }
  return accepted;
}

try {
  const latest = await client.getBlockNumber();
  const ponsCounts = await Promise.all(
    factories.map((factory) => syncV1Factory(factory, latest)),
  );
  const [v2Count, stockCount] = await Promise.all([
    syncV2(latest),
    syncStocks(),
  ]);
  console.log(
    JSON.stringify({
      ponsAccepted: ponsCounts.reduce((sum, count) => sum + count, v2Count),
      stockAccepted: stockCount,
      observedBlock: latest.toString(),
    }),
  );
} finally {
  await sql.end();
}
