import postgres from "postgres";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
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
    PONS_SWAP_INITIAL_LOOKBACK: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(500_000)
      .default(100_000),
    PONS_LOG_CHUNK_SIZE: z.coerce
      .number()
      .int()
      .min(100)
      .max(50_000)
      .default(10_000),
  })
  .parse(process.env);

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);
const swapEvent = parseAbiItem(
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
);
const q192 = 2n ** 192n;
const priceScale = 10n ** 18n;
const client = createPublicClient({ transport: http(config.PONS_RPC_URL) });
const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});

type Market = Readonly<{
  id: string;
  external_id: string;
  pool_identifier: string;
}>;

function scaledPrice(
  sqrtPriceX96: bigint,
  marketIsToken0: boolean,
  token0Decimals: number,
  token1Decimals: number,
) {
  const square = sqrtPriceX96 * sqrtPriceX96;
  const token0Scale = 10n ** BigInt(token0Decimals);
  const token1Scale = 10n ** BigInt(token1Decimals);
  const numerator = marketIsToken0
    ? square * token0Scale * priceScale
    : q192 * token1Scale * priceScale;
  const denominator = marketIsToken0
    ? q192 * token1Scale
    : square * token0Scale;
  if (denominator === 0n) throw new Error("Invalid zero pool price");
  return formatUnits(numerator / denominator, 18);
}

async function checkpoint(marketId: string) {
  const consumer = `external-swaps-${marketId}`;
  const rows = await sql.unsafe<{ last_processed_block: string }[]>(
    `select last_processed_block::text from ${config.SUPABASE_SCHEMA}.ingestion_checkpoints
     where consumer=$1 and chain_id=4663`,
    [consumer],
  );
  return { consumer, block: rows[0]?.last_processed_block };
}

async function saveCheckpoint(consumer: string, blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error(`Missing block hash for ${blockNumber}`);
  await sql.unsafe(
    `insert into ${config.SUPABASE_SCHEMA}.ingestion_checkpoints
      (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block)
     values ($1,4663,$2,$3,$2)
     on conflict (consumer,chain_id) do update set
       last_processed_block=excluded.last_processed_block,
       last_processed_hash=excluded.last_processed_hash,
       finalized_block=excluded.finalized_block,
       updated_at=now()`,
    [consumer, blockNumber.toString(), block.hash.toLowerCase()],
  );
}

async function syncMarket(market: Market, latest: bigint) {
  const pool = getAddress(market.pool_identifier);
  const marketToken = getAddress(market.external_id);
  const [token0, token1] = await Promise.all([
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
  ]);
  const marketIsToken0 = token0 === marketToken;
  if (!marketIsToken0 && token1 !== marketToken)
    throw new Error(`Market token ${marketToken} is not in pool ${pool}`);
  const [token0Decimals, token1Decimals] = await Promise.all([
    client.readContract({
      address: token0,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: token1,
      abi: tokenAbi,
      functionName: "decimals",
    }),
  ]);
  const saved = await checkpoint(market.id);
  const initial =
    latest > BigInt(config.PONS_SWAP_INITIAL_LOOKBACK)
      ? latest - BigInt(config.PONS_SWAP_INITIAL_LOOKBACK)
      : 0n;
  const fromBlock = saved.block ? BigInt(saved.block) + 1n : initial;
  if (fromBlock > latest) return 0;
  let accepted = 0;
  for (
    let from = fromBlock;
    from <= latest;
    from += BigInt(config.PONS_LOG_CHUNK_SIZE)
  ) {
    const end = from + BigInt(config.PONS_LOG_CHUNK_SIZE - 1);
    const to = end < latest ? end : latest;
    const logs = await client.getLogs({
      address: pool,
      event: swapEvent,
      fromBlock: from,
      toBlock: to,
    });
    const blockTimestamps = new Map<bigint, Date>();
    for (const log of logs) {
      if (
        log.blockNumber === null ||
        !log.transactionHash ||
        log.logIndex === null ||
        log.args.sqrtPriceX96 === undefined ||
        log.args.amount0 === undefined ||
        log.args.amount1 === undefined
      )
        continue;
      let observedAt = blockTimestamps.get(log.blockNumber);
      if (!observedAt) {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        observedAt = new Date(Number(block.timestamp) * 1_000);
        blockTimestamps.set(log.blockNumber, observedAt);
      }
      const quoteRaw = marketIsToken0 ? log.args.amount1 : log.args.amount0;
      const quoteDecimals = marketIsToken0 ? token1Decimals : token0Decimals;
      const sourceHash = keccak256(
        stringToHex(`${log.transactionHash}:${log.logIndex}`),
      );
      await sql.unsafe(
        `insert into ${config.SUPABASE_SCHEMA}.external_market_price_points
          (market_id,source,observed_at,price,volume,block_number,transaction_hash,source_hash)
         values ($1,'swap',$2,$3,$4,$5,$6,$7)
         on conflict (market_id,source,observed_at,source_hash) do nothing`,
        [
          market.id,
          observedAt,
          scaledPrice(
            log.args.sqrtPriceX96,
            marketIsToken0,
            token0Decimals,
            token1Decimals,
          ),
          formatUnits(quoteRaw < 0n ? -quoteRaw : quoteRaw, quoteDecimals),
          log.blockNumber.toString(),
          log.transactionHash.toLowerCase(),
          sourceHash,
        ],
      );
      accepted += 1;
    }
  }
  await saveCheckpoint(saved.consumer, latest);
  return accepted;
}

try {
  const latest = await client.getBlockNumber();
  const markets = await sql.unsafe<Market[]>(
    `select id,external_id,metadata->>'poolIdentifier' as pool_identifier
     from ${config.SUPABASE_SCHEMA}.external_markets
     where source='pons_graduated' and status='active'
       and metadata->>'version' like 'v1-%'
       and metadata->>'poolIdentifier' ~ '^0x[0-9a-fA-F]{40}$'`,
  );
  let accepted = 0;
  for (const market of markets) accepted += await syncMarket(market, latest);
  console.log(
    JSON.stringify({ markets: markets.length, swapsAccepted: accepted }),
  );
} finally {
  await sql.end();
}
