import postgres from "postgres";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
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
    CHAINLINK_FEED_REGISTRY_URL: z
      .string()
      .url()
      .default(
        "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood",
      ),
  })
  .parse(process.env);

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);
const tokenAbi = parseAbi([
  "function oraclePaused() view returns (bool)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const client = createPublicClient({ transport: http(config.PONS_RPC_URL) });
const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});
const deadAddress = getAddress("0x000000000000000000000000000000000000dEaD");
const zeroAddress = getAddress("0x0000000000000000000000000000000000000000");

type Feed = Readonly<{ address: `0x${string}`; heartbeat: number }>;
type Market = Readonly<{
  id: string;
  source: "pons_graduated" | "robinhood_stock_token";
  contract_address: string;
  symbol: string;
}>;

function decodeHtml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'");
}

function parseRobinhoodFeeds(html: string) {
  const decoded = decodeHtml(html);
  const start = decoded.indexOf('"robinhood":[0,{');
  const end = decoded.indexOf('"ronin":[0,{', start);
  if (start < 0 || end <= start)
    throw new Error("Robinhood Chain feed registry segment was not found");
  const segment = decoded.slice(start, end);
  const pattern =
    /"heartbeat":\[0,(\d+)\][\s\S]{0,800}?"name":\[0,"([^"]+)"\][\s\S]{0,700}?"proxyAddress":\[0,"(0x[0-9A-Fa-f]{40})"\]/gu;
  const stocks = new Map<string, Feed>();
  let ethUsd: Feed | null = null;
  for (const match of segment.matchAll(pattern)) {
    const heartbeat = Number(match[1]);
    const name = match[2]!;
    const address = getAddress(match[3]!);
    const stock = /^Robinhood ([A-Z0-9.]+)\s*(?:\/|-)\s*USD$/u.exec(name);
    if (stock) stocks.set(stock[1]!, { address, heartbeat });
    if (name === "ETH / USD") ethUsd = { address, heartbeat };
  }
  if (!stocks.size || !ethUsd)
    throw new Error(
      "No usable Robinhood Chain feeds found in official registry",
    );
  return { stocks, ethUsd };
}

async function latestFeed(
  feed: Feed,
  marketHours: "continuous" | "equity24x5",
) {
  const [decimals, round] = await Promise.all([
    client.readContract({
      address: feed.address,
      abi: feedAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: feed.address,
      abi: feedAbi,
      functionName: "latestRoundData",
    }),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (answer <= 0n || updatedAt <= 0n || updatedAt > now)
    throw new Error(`Invalid oracle answer from ${feed.address}`);
  if (answeredInRound < roundId)
    throw new Error(`Incomplete oracle round from ${feed.address}`);
  const age = now - updatedAt;
  if (age > BigInt(feed.heartbeat)) {
    const observedDay = new Date(Number(updatedAt) * 1_000).getUTCDay();
    const currentDay = new Date(Number(now) * 1_000).getUTCDay();
    const weekendClose =
      marketHours === "equity24x5" &&
      observedDay === 5 &&
      [0, 1, 6].includes(currentDay) &&
      age <= 72n * 60n * 60n;
    if (!weekendClose)
      throw new Error(`Stale oracle answer from ${feed.address}`);
  }
  return {
    price: formatUnits(answer, decimals),
    observedAt: new Date(Number(updatedAt) * 1_000),
    roundId: roundId.toString(),
  };
}

async function tokenOraclePaused(address: `0x${string}`) {
  try {
    return await client.readContract({
      address,
      abi: tokenAbi,
      functionName: "oraclePaused",
    });
  } catch {
    return true;
  }
}

async function persistOracle(market: Market, feed: Feed) {
  const token = getAddress(market.contract_address);
  if (await tokenOraclePaused(token)) return false;
  const point = await latestFeed(feed, "equity24x5");
  const sourceHash = keccak256(
    stringToHex(
      `${feed.address.toLowerCase()}:${point.roundId}:${point.price}:${point.observedAt.toISOString()}`,
    ),
  );
  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      `update ${config.SUPABASE_SCHEMA}.external_markets
       set oracle_provider='chainlink_data_feed',oracle_feed_id=$2,
         oracle_heartbeat_seconds=$3,updated_at=now()
       where id=$1`,
      [market.id, feed.address.toLowerCase(), feed.heartbeat],
    );
    await transaction.unsafe(
      `insert into ${config.SUPABASE_SCHEMA}.external_market_price_points
        (market_id,source,observed_at,price,source_hash)
       values ($1,'oracle',$2,$3,$4)
       on conflict (market_id,source,observed_at,source_hash) do nothing`,
      [market.id, point.observedAt, point.price, sourceHash],
    );
  });
  return true;
}

async function updatePonsMarketCaps(ethUsd: number) {
  const markets = await sql.unsafe<Market[]>(
    `select id,source,contract_address,symbol
     from ${config.SUPABASE_SCHEMA}.external_markets
     where source='pons_graduated' and status='active'`,
  );
  let updated = 0;
  for (const market of markets) {
    const token = getAddress(market.contract_address);
    const [decimals, totalSupply, zeroBalance, deadBalance] = await Promise.all(
      [
        client.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "decimals",
        }),
        client.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "totalSupply",
        }),
        client.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [zeroAddress],
        }),
        client.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [deadAddress],
        }),
      ],
    );
    const points = await sql.unsafe<{ price: string; observed_at: Date }[]>(
      `select price::text,observed_at
       from ${config.SUPABASE_SCHEMA}.external_market_price_points
       where market_id=$1 and source='swap'
       order by observed_at desc limit 1`,
      [market.id],
    );
    const point = points[0];
    if (!point || Date.now() - point.observed_at.getTime() > 7 * 86_400_000)
      continue;
    const circulating = totalSupply - zeroBalance - deadBalance;
    const supply = Number(formatUnits(circulating, decimals));
    const marketCap = supply * Number(point.price) * ethUsd;
    if (!Number.isFinite(marketCap) || marketCap <= 0) continue;
    await sql.unsafe(
      `update ${config.SUPABASE_SCHEMA}.external_markets
       set market_cap_usd=$2,market_cap_observed_at=$3,updated_at=now()
       where id=$1`,
      [market.id, marketCap.toFixed(2), point.observed_at],
    );
    updated += 1;
  }
  return updated;
}

try {
  const response = await fetch(config.CHAINLINK_FEED_REGISTRY_URL);
  if (!response.ok)
    throw new Error(`Chainlink registry request failed: ${response.status}`);
  const feeds = parseRobinhoodFeeds(await response.text());
  const markets = await sql.unsafe<Market[]>(
    `select id,source,contract_address,symbol
     from ${config.SUPABASE_SCHEMA}.external_markets
     where source='robinhood_stock_token' and status='active'`,
  );
  let oracleAccepted = 0;
  let staleOrPaused = 0;
  for (const market of markets) {
    const feed = feeds.stocks.get(market.symbol);
    if (!feed) continue;
    try {
      if (await persistOracle(market, feed)) oracleAccepted += 1;
      else staleOrPaused += 1;
    } catch {
      staleOrPaused += 1;
    }
  }
  const eth = await latestFeed(feeds.ethUsd, "continuous");
  const marketCapsUpdated = await updatePonsMarketCaps(Number(eth.price));
  console.log(
    JSON.stringify({
      registryStockFeeds: feeds.stocks.size,
      oracleAccepted,
      staleOrPaused,
      marketCapsUpdated,
      ethUsdObservedAt: eth.observedAt.toISOString(),
    }),
  );
} finally {
  await sql.end();
}
