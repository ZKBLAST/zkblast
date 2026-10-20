import {
  formatUnits,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type PublicClient,
} from "viem";

type Feed = { address: Address; heartbeat: number };
const abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
export function parseStockChartFeeds(html: string) {
  const decoded = html.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const start = decoded.indexOf('"robinhood":[0,{');
  const end = decoded.indexOf('"ronin":[0,{', start);
  if (start < 0 || end <= start) throw new Error("ORACLE_REGISTRY_UNAVAILABLE");
  const feeds = new Map<string, Feed>();
  const pattern =
    /"heartbeat":\[0,(\d+)\][\s\S]{0,800}?"name":\[0,"([^"]+)"\][\s\S]{0,700}?"proxyAddress":\[0,"(0x[0-9A-Fa-f]{40})"\]/gu;
  for (const match of decoded.slice(start, end).matchAll(pattern)) {
    const symbol = /^Robinhood ([A-Z0-9.]+)\s*(?:\/|-)\s*USD$/u.exec(match[2]!);
    if (symbol)
      feeds.set(symbol[1]!, {
        address: getAddress(match[3]!),
        heartbeat: Number(match[1]),
      });
  }
  if (!feeds.size) throw new Error("ORACLE_REGISTRY_EMPTY");
  return feeds;
}

export async function stockOracleHistory(
  client: PublicClient,
  feed: Feed,
  backfill: boolean,
) {
  const [decimals, latest] = await Promise.all([
    client.readContract({
      address: feed.address,
      abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: feed.address,
      abi,
      functionName: "latestRoundData",
    }),
  ]);
  if (decimals > 36) throw new Error("ORACLE_DECIMALS_UNSUPPORTED");
  const now = Math.floor(Date.now() / 1000);
  const latestTime = Number(latest[3]);
  const age = now - latestTime;
  const weekend =
    new Date(latestTime * 1000).getUTCDay() === 5 &&
    [0, 1, 6].includes(new Date(now * 1000).getUTCDay()) &&
    age <= 72 * 3600;
  if (age < 0 || (age > feed.heartbeat && !weekend))
    throw new Error("ORACLE_STALE");
  const rounds = [latest];
  if (backfill)
    for (
      let offset = 1n;
      offset < 12n && (latest[0] & ((1n << 64n) - 1n)) > offset;
      offset++
    ) {
      const round = await client
        .readContract({
          address: feed.address,
          abi,
          functionName: "getRoundData",
          args: [latest[0] - offset],
        })
        .catch(() => null);
      if (round) rounds.push(round);
    }
  return rounds
    .filter(
      ([id, answer, , time, answered]) =>
        answer > 0n && time > 0n && time <= BigInt(now) && answered >= id,
    )
    .map(([id, answer, , time]) => ({
      price: formatUnits(answer, decimals),
      observedAt: new Date(Number(time) * 1000),
      sourceHash: keccak256(
        toHex(`${feed.address.toLowerCase()}:${id}:${answer}:${time}`),
      ),
    }));
}
