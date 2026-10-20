"use client";

import { AssetLogo } from "./AssetLogo";
export { isNearlySquare } from "./AssetLogo";

import type { ExternalMarket } from "@/types/application";

type MarketPairSource = Readonly<{
  quoteSymbol: string;
  pairCandidates: readonly Readonly<{
    quoteSymbol: "USDG" | "WETH" | "ETH";
    logoUrl: string | null;
    routeStatus: "planned" | "observed" | "validated" | "disabled";
  }>[];
}>;

export function preferredMarketPair(market: MarketPairSource) {
  return (
    market.pairCandidates.find((pair) => pair.routeStatus === "validated") ??
    market.pairCandidates[0] ??
    null
  );
}

export function marketDisplayQuoteSymbol(market: MarketPairSource) {
  return preferredMarketPair(market)?.quoteSymbol ?? market.quoteSymbol;
}

export function MarketPairLogo({ market }: { market: ExternalMarket }) {
  const quote = preferredMarketPair(market);
  const quoteSymbol = (quote?.quoteSymbol ?? market.quoteSymbol).toUpperCase();

  return (
    <span
      className="relative block h-10 w-14 shrink-0"
      aria-label={`${market.symbol}/${marketDisplayQuoteSymbol(market)}`}
    >
      <AssetLogo
        url={market.logoUrl}
        label={market.symbol}
        className="absolute left-0 top-0 z-10"
      />
      <AssetLogo
        url={
          KNOWN_ASSET_LOGOS[quoteSymbol] ??
          quote?.logoUrl ??
          market.quoteLogoUrl ??
          null
        }
        label={quote?.quoteSymbol ?? market.quoteSymbol}
        className="absolute left-5 top-0"
      />
    </span>
  );
}

const KNOWN_ASSET_LOGOS: Readonly<Record<string, string>> = {
  USDG: "/asset-logo/USDG",
  WETH: "/asset-logo/WETH",
  ETH: "/asset-logo/ETH",
};

export function ProtocolPairLogo({
  base,
  quote,
  markets,
}: Readonly<{
  base: string;
  quote: string;
  markets: readonly ExternalMarket[];
}>) {
  const market = markets.find(
    (candidate) => candidate.symbol.toUpperCase() === base.toUpperCase(),
  );
  const pair = market?.pairCandidates.find(
    (candidate) => candidate.quoteSymbol === quote.toUpperCase(),
  );
  return (
    <span
      className="relative block h-10 w-14 shrink-0"
      aria-label={`${base}/${quote}`}
    >
      <AssetLogo
        url={KNOWN_ASSET_LOGOS[base.toUpperCase()] ?? market?.logoUrl ?? null}
        label={base}
        className="absolute left-0 top-0 z-10"
      />
      <AssetLogo
        url={KNOWN_ASSET_LOGOS[quote.toUpperCase()] ?? pair?.logoUrl ?? null}
        label={quote}
        className="absolute left-5 top-0"
      />
    </span>
  );
}
