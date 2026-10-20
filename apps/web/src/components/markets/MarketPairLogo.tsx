"use client";

import { CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExternalMarket } from "@/types/application";

export function isNearlySquare(width: number, height: number) {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.1;
}

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
        className="absolute left-5 top-1"
      />
    </span>
  );
}

const KNOWN_ASSET_LOGOS: Readonly<Record<string, string>> = {
  USDG: "/api/asset-logo/USDG",
  WETH: "/api/asset-logo/WETH",
  ETH: "/api/asset-logo/ETH",
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
        className="absolute left-5 top-1"
      />
    </span>
  );
}

function AssetLogo({
  url,
  label,
  className,
}: {
  url: string | null;
  label: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const [square, setSquare] = useState(false);
  const [loading, setLoading] = useState(Boolean(url));
  useEffect(() => {
    setFailed(false);
    setSquare(false);
    setLoading(Boolean(url));
  }, [url]);

  return (
    <span
      className={`${className} grid size-9 place-items-center overflow-hidden rounded-full border-2 border-white bg-white`}
      title={label}
    >
      {url && !failed ? (
        <>
          {loading && (
            <span className="logo-shimmer absolute inset-0 rounded-full" aria-hidden="true" />
          )}
          <img
            src={url}
            alt=""
            className={`${square ? "size-full scale-[1.08] object-cover" : "size-full object-contain p-1"} transition-opacity duration-200 ${loading ? "opacity-0" : "opacity-100"}`}
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              const image = event.currentTarget;
              setSquare(isNearlySquare(image.naturalWidth, image.naturalHeight));
              setLoading(false);
            }}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
          />
        </>
      ) : (
        <CircleDashed className="size-4 text-black" aria-hidden="true" />
      )}
    </span>
  );
}
