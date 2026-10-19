"use client";

import { CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExternalMarket } from "@/types/application";

export function MarketPairLogo({ market }: { market: ExternalMarket }) {
  const quote =
    market.pairCandidates.find((pair) => pair.routeStatus === "validated") ??
    market.pairCandidates[0];

  return (
    <span
      className="relative block h-10 w-14 shrink-0"
      aria-label={`${market.symbol}/${quote?.quoteSymbol ?? market.quoteSymbol}`}
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
  useEffect(() => setFailed(false), [url]);

  return (
    <span
      className={`${className} grid size-9 place-items-center overflow-hidden rounded-full border-2 border-white bg-white`}
      title={label}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          className="size-full object-contain p-1"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <CircleDashed className="size-4 text-black" aria-hidden="true" />
      )}
    </span>
  );
}
