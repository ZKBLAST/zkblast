import type {
  ExternalMarket,
  ProtocolPool,
  ProtocolExecutionPool,
} from "@/types/application";
import { marketDisplayQuoteSymbol } from "@/components/markets/MarketPairLogo";

export type TradeInstrument = Readonly<{
  id: string;
  base: string;
  quote: string;
  market: ExternalMarket | null;
  pool: ProtocolExecutionPool | null;
}>;

export function tradeInstruments(
  pools: readonly ProtocolPool[],
  markets: readonly ExternalMarket[],
  chainId?: number,
): TradeInstrument[] {
  const executable = pools
    .filter((pool) => pool.status === "active")
    .map((pool) => ({
      id: pool.address.toLowerCase(),
      base: pool.token0Symbol,
      quote: pool.token1Symbol,
      pool,
      market:
        markets.find(
          (market) =>
            market.contractAddress.toLowerCase() ===
              pool.token0Address.toLowerCase() ||
            market.contractAddress.toLowerCase() ===
              pool.token1Address.toLowerCase(),
        ) ?? null,
    }));
  const assets = new Map(
    pools.flatMap((pool) => [
      [
        pool.token0Address.toLowerCase(),
        { symbol: pool.token0Symbol, decimals: pool.token0Decimals },
      ] as const,
      [
        pool.token1Address.toLowerCase(),
        { symbol: pool.token1Symbol, decimals: pool.token1Decimals },
      ] as const,
    ]),
  );
  const routed: TradeInstrument[] = [];
  for (const market of markets) {
    for (const route of market.pairCandidates) {
      if (
        route.routeStatus !== "validated" ||
        route.executionChainId !== chainId ||
        !route.poolIdentifier ||
        !/^0x[\da-f]{40}$/iu.test(route.poolIdentifier) ||
        !route.baseAddress ||
        route.baseAddress.toLowerCase() !==
          market.contractAddress.toLowerCase() ||
        !["zkblast_damm", "zkblast_dlmm"].includes(route.venue ?? "")
      )
        continue;
      if (
        pools.some(
          (pool) =>
            pool.address.toLowerCase() === route.poolIdentifier?.toLowerCase(),
        )
      )
        continue;
      const quote = assets.get(route.quoteAddress.toLowerCase());
      const decimals = market.metadata?.executionDecimals;
      if (
        !quote ||
        quote.symbol !== route.quoteSymbol ||
        typeof decimals !== "number" ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 36
      )
        continue;
      const baseFirst =
        route.baseAddress.toLowerCase() < route.quoteAddress.toLowerCase();
      routed.push({
        id: route.poolIdentifier.toLowerCase(),
        base: market.symbol,
        quote: route.quoteSymbol,
        market,
        pool: {
          address: route.poolIdentifier,
          chainId: route.executionChainId,
          model: route.venue === "zkblast_dlmm" ? "dlmm" : "damm",
          status: "active",
          feeBps: null,
          createdBlock: null,
          token0Address: baseFirst ? route.baseAddress : route.quoteAddress,
          token0Symbol: baseFirst ? market.symbol : quote.symbol,
          token0Decimals: baseFirst ? decimals : quote.decimals,
          token1Address: baseFirst ? route.quoteAddress : route.baseAddress,
          token1Symbol: baseFirst ? quote.symbol : market.symbol,
          token1Decimals: baseFirst ? quote.decimals : decimals,
        },
      });
    }
  }
  const allExecutable = [...executable, ...routed];
  const catalog = markets
    .filter(
      (market) => !allExecutable.some((item) => item.market?.id === market.id),
    )
    .map((market) => ({
      id: market.id,
      base: market.symbol,
      quote: marketDisplayQuoteSymbol(market),
      market,
      pool: null,
    }));
  return [
    ...allExecutable.sort(
      (a, b) =>
        Number(b.pool?.model === "dlmm") - Number(a.pool?.model === "dlmm"),
    ),
    ...catalog,
  ];
}

export const tradeModes = ["swap", "liquidity", "shielded", "create"] as const;
export type TradeMode = (typeof tradeModes)[number];
export const tradePanels = ["positions", "history", "activity"] as const;
export type TradePanel = (typeof tradePanels)[number];
export function tradeMode(value: string | null): TradeMode {
  return tradeModes.find((mode) => mode === value) ?? "swap";
}
export function tradePanel(value: string | null): TradePanel {
  return tradePanels.find((panel) => panel === value) ?? "positions";
}
