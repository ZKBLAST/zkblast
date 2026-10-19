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
    quoteSymbol: "USDG" | "WETH";
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
        url={quote?.logoUrl ?? null}
        label={quote?.quoteSymbol ?? market.quoteSymbol}
        className="absolute left-5 top-1"
      />
    </span>
  );
}

const KNOWN_ASSET_LOGOS: Readonly<Record<string, string>> = {
  USDG: "https://mintcdn.com/paxos-0ac97319/ykAU2vouTvwgGjtD/images/usdg.png?fit=max&auto=format&n=ykAU2vouTvwgGjtD&q=85&s=3a2dfa481556c8322f0271baedb00afe",
  WETH: "https://images.cryptorank.io/coins/weth1701090834118.png",
  ETH: "https://pbs.twimg.com/media/HM8jiM9WAAAGui1?format=webp&name=large",
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
        url={market?.logoUrl ?? KNOWN_ASSET_LOGOS[base.toUpperCase()] ?? null}
        label={base}
        className="absolute left-0 top-0 z-10"
      />
      <AssetLogo
        url={pair?.logoUrl ?? KNOWN_ASSET_LOGOS[quote.toUpperCase()] ?? null}
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
  useEffect(() => {
    setFailed(false);
    setSquare(false);
  }, [url]);

  return (
    <span
      className={`${className} grid size-9 place-items-center overflow-hidden rounded-full border-2 border-white bg-white`}
      title={label}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          className={
            square
              ? "size-full scale-[1.08] object-cover"
              : "size-full object-contain p-1"
          }
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const image = event.currentTarget;
            setSquare(isNearlySquare(image.naturalWidth, image.naturalHeight));
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <CircleDashed className="size-4 text-black" aria-hidden="true" />
      )}
    </span>
  );
}
