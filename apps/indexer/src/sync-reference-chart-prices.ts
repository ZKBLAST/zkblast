import {
  stockAssetResponseSchema,
  stockQuoteResponseSchema,
} from "@zkblast/database";
import type postgres from "postgres";
import {
  formatUnits,
  getAddress,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  type Address,
  type PublicClient,
} from "viem";
import {
  parseStockChartFeeds,
  stockOracleHistory,
} from "./chart-oracle-source.js";

const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function oraclePaused() view returns (bool)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
]);
type Market = {
  id: string;
  source: string;
  symbol: string;
  contract_address: string;
  chain_id: string;
  metadata: Record<string, unknown>;
  has_oracle: boolean;
  has_reference: boolean;
};
async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("REFERENCE_PROVIDER_UNAVAILABLE");
  return response.json() as Promise<unknown>;
}
export function quoteMidpoint(bid: string, ask: string) {
  if (![bid, ask].every((value) => /^\d{1,40}(?:\.\d{1,36})?$/u.test(value)))
    throw new Error("INVALID_QUOTE_DECIMAL");
  const first = parseUnits(bid, 36),
    second = parseUnits(ask, 36);
  if (first <= 0n || second < first) throw new Error("INVALID_QUOTE_SPREAD");
  return formatUnits((first + second) / 2n, 36);
}
export function poolStatePrice(
  sqrtPriceX96: bigint,
  baseIsToken0: boolean,
  baseDecimals: number,
  quoteDecimals: number,
) {
  if (sqrtPriceX96 <= 0n || baseDecimals > 36 || quoteDecimals > 36)
    throw new Error("INVALID_REFERENCE_POOL_PRICE");
  const square = sqrtPriceX96 ** 2n,
    q192 = 2n ** 192n;
  const numerator = baseIsToken0 ? square : q192;
  const denominator = baseIsToken0 ? q192 : square;
  const raw =
    (numerator * 10n ** BigInt(baseDecimals) * 10n ** 18n) /
    (denominator * 10n ** BigInt(quoteDecimals));
  if (raw <= 0n) throw new Error("REFERENCE_PRICE_UNREPRESENTABLE");
  return formatUnits(raw, 18);
}

/** Existing market identities only; no token creation, duplicate catalogue rows, or provider credentials in outputs. */
export async function syncReferenceChartPrices(input: {
  client: PublicClient;
  sql: postgres.Sql;
  schema: string;
  stockApi: string;
  feedRegistry: string;
}) {
  const { client, sql, schema } = input;
  if (
    !/^zkblast_(testnet|mainnet)$/u.test(schema) ||
    (await client.getChainId()) !== 4663
  )
    throw new Error("REFERENCE_NETWORK_MISMATCH");
  const markets = await sql.unsafe<
    Market[]
  >(`select m.id,m.source,m.symbol,m.contract_address,m.chain_id::text,m.metadata,
    exists(select 1 from ${schema}.external_market_price_points p where p.market_id=m.id and p.source='oracle') as has_oracle,
    exists(select 1 from ${schema}.external_market_price_points p where p.market_id=m.id and p.source='reference') as has_reference
    from ${schema}.external_markets m where m.status='active' order by m.symbol limit 250`);
  const stats = {
    referenceAccepted: 0,
    oracleAccepted: 0,
    unavailable: 0,
    failures: {} as Record<string, number>,
  };
  const assets = await fetchJson(`${input.stockApi}/assets`)
    .then((value) => stockAssetResponseSchema.parse(value).assets)
    .catch(() => []);
  const feeds = await fetch(input.feedRegistry, {
    signal: AbortSignal.timeout(20000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("REGISTRY_UNAVAILABLE");
      return parseStockChartFeeds(await response.text());
    })
    .catch(() => new Map<string, { address: Address; heartbeat: number }>());
  for (const market of markets) {
    try {
      if (Number(market.chain_id) !== 4663) {
        stats.unavailable++;
        continue;
      }
      const address = getAddress(market.contract_address);
      if (market.source === "robinhood_stock_token") {
        const feed = feeds.get(market.symbol);
        const asset = assets.find(
          (item) =>
            item.tokenSymbol === market.symbol &&
            item.deployments.some(
              (entry) => getAddress(entry.contractAddress) === address,
            ),
        );
        if (!feed && !asset) {
          stats.unavailable++;
          continue;
        }
        const [code, symbol] = await Promise.all([
          client.getBytecode({ address }),
          client.readContract({
            address,
            abi: tokenAbi,
            functionName: "symbol",
          }),
        ]);
        if (!code || code === "0x" || symbol !== market.symbol)
          throw new Error("REFERENCE_TOKEN_METADATA_MISMATCH");
        // Independent on-chain feed availability must not depend on the HTTP quote provider.
        const paused = await client
          .readContract({
            address,
            abi: tokenAbi,
            functionName: "oraclePaused",
          })
          .catch(() => true);
        if (feed && !paused) {
          const points = await stockOracleHistory(
            client,
            feed,
            !market.has_oracle,
          ).catch(() => []);
          for (const point of points)
            await sql.unsafe(
              `insert into ${schema}.external_market_price_points (market_id,source,observed_at,price,source_hash)
              values ($1,'oracle',$2,$3,$4) on conflict (market_id,source,observed_at,source_hash) do nothing`,
              [market.id, point.observedAt, point.price, point.sourceHash],
            );
          if (points.length) {
            await sql.unsafe(
              `update ${schema}.external_markets set oracle_provider='chainlink_data_feed',oracle_feed_id=$2,oracle_heartbeat_seconds=$3,updated_at=now() where id=$1`,
              [market.id, feed.address.toLowerCase(), feed.heartbeat],
            );
            stats.oracleAccepted += points.length;
          }
        }
        if (!asset) {
          stats.unavailable++;
          continue;
        }
        const quotes = stockQuoteResponseSchema.parse(
          await fetchJson(
            `${input.stockApi}/prices/${encodeURIComponent(market.symbol)}`,
          ),
        ).quotes;
        const quote = quotes.find(
          (item) =>
            item.tokenSymbol === market.symbol &&
            item.deployments.some(
              (entry) => getAddress(entry.contractAddress) === address,
            ),
        );
        if (!quote) throw new Error("REFERENCE_ADDRESS_MISMATCH");
        const observedAt = new Date(quote.generatedAt);
        if (observedAt.getTime() > Date.now())
          throw new Error("FUTURE_REFERENCE_QUOTE");
        const price = quoteMidpoint(quote.bid, quote.ask);
        const sourceHash = keccak256(toHex(JSON.stringify(quote)));
        await sql.begin(async (tx) => {
          await tx.unsafe(
            `insert into ${schema}.external_market_quotes (market_id,observed_at,bid,ask,currency,daily_volume,source_hash)
            values ($1,$2,$3,$4,$5,$6,$7) on conflict (market_id,observed_at) do nothing`,
            [
              market.id,
              observedAt,
              quote.bid,
              quote.ask,
              quote.currency,
              quote.dailyTradingVolume,
              sourceHash,
            ],
          );
          await tx.unsafe(
            `insert into ${schema}.external_market_price_points (market_id,source,observed_at,price,source_hash)
            values ($1,'reference',$2,$3,$4) on conflict (market_id,source,observed_at,source_hash) do nothing`,
            [market.id, observedAt, price, sourceHash],
          );
        });
        stats.referenceAccepted++;
      } else {
        const poolValue = market.metadata.poolIdentifier;
        const quoteValue = market.metadata.sourceQuoteAddress;
        if (
          typeof poolValue !== "string" ||
          !/^0x[\da-f]{40}$/iu.test(poolValue) ||
          typeof quoteValue !== "string"
        ) {
          stats.unavailable++;
          continue;
        }
        const pool = getAddress(poolValue),
          quote = getAddress(quoteValue);
        const head = await client.getBlockNumber();
        if (head < 5n) continue;
        const block = await client.getBlock({ blockNumber: head - 5n });
        const [token0, token1, slot, baseDecimals, quoteDecimals, unit] =
          await Promise.all([
            client.readContract({
              address: pool,
              abi: poolAbi,
              functionName: "token0",
              blockNumber: block.number,
            }),
            client.readContract({
              address: pool,
              abi: poolAbi,
              functionName: "token1",
              blockNumber: block.number,
            }),
            client.readContract({
              address: pool,
              abi: poolAbi,
              functionName: "slot0",
              blockNumber: block.number,
            }),
            client.readContract({
              address,
              abi: tokenAbi,
              functionName: "decimals",
              blockNumber: block.number,
            }),
            client.readContract({
              address: quote,
              abi: tokenAbi,
              functionName: "decimals",
              blockNumber: block.number,
            }),
            client.readContract({
              address: quote,
              abi: tokenAbi,
              functionName: "symbol",
              blockNumber: block.number,
            }),
          ]);
        if (
          !new Set([getAddress(token0), getAddress(token1)]).has(address) ||
          !new Set([getAddress(token0), getAddress(token1)]).has(quote) ||
          baseDecimals > 36 ||
          quoteDecimals > 36 ||
          slot[0] <= 0n ||
          !unit.length ||
          unit.length > 24
        )
          throw new Error("REFERENCE_POOL_TOKEN_MISMATCH");
        const price = poolStatePrice(
          slot[0],
          getAddress(token0) === address,
          baseDecimals,
          quoteDecimals,
        );
        if (!block.hash) throw new Error("REFERENCE_BLOCK_UNAVAILABLE");
        const sourceHash = keccak256(toHex(`${pool}:${block.hash}:${slot[0]}`));
        await sql.begin(async (tx) => {
          await tx.unsafe(
            `update ${schema}.external_markets set metadata=metadata ||
              jsonb_build_object('chartReferenceUnit',$2::text,'chartReferenceKind','external_pool_spot') where id=$1`,
            [market.id, unit],
          );
          await tx.unsafe(
            `insert into ${schema}.external_market_price_points (market_id,source,observed_at,price,block_number,source_hash)
            values ($1,'reference',$2,$3,$4,$5) on conflict (market_id,source,observed_at,source_hash) do nothing`,
            [
              market.id,
              new Date(Number(block.timestamp) * 1000),
              price,
              block.number.toString(),
              sourceHash,
            ],
          );
        });
        if (!market.has_reference)
          for (const offset of [10000n, 45000n, 90000n, 180000n]) {
            if (block.number <= offset) continue;
            try {
              const prior = await client.getBlock({
                blockNumber: block.number - offset,
              });
              const priorSlot = await client.readContract({
                address: pool,
                abi: poolAbi,
                functionName: "slot0",
                blockNumber: prior.number,
              });
              const price = poolStatePrice(
                priorSlot[0],
                getAddress(token0) === address,
                baseDecimals,
                quoteDecimals,
              );
              if (!prior.hash) continue;
              const hash = keccak256(
                toHex(`${pool}:${prior.hash}:${priorSlot[0]}`),
              );
              await sql.unsafe(
                `insert into ${schema}.external_market_price_points (market_id,source,observed_at,price,block_number,source_hash)
              values ($1,'reference',$2,$3,$4,$5) on conflict (market_id,source,observed_at,source_hash) do nothing`,
                [
                  market.id,
                  new Date(Number(prior.timestamp) * 1000),
                  price,
                  prior.number.toString(),
                  hash,
                ],
              );
            } catch {
              /* Pruned or pre-deployment states are unavailable, never fabricated. */
            }
          }
        stats.referenceAccepted++;
      }
    } catch (error) {
      // Never log provider URLs, SQL parameters, or credential-bearing messages.
      const code =
        error instanceof Error && /^[A-Z][A-Z_]{3,80}$/u.test(error.message)
          ? error.message
          : error instanceof Error &&
              "code" in error &&
              /^\d{2}[A-Z\d]{3}$/u.test(String(error.code))
            ? `DATABASE_${String(error.code)}`
            : error instanceof Error
              ? error.name
              : "UNKNOWN";
      stats.failures[code] = (stats.failures[code] ?? 0) + 1;
      stats.unavailable++;
    }
  }
  return stats;
}
