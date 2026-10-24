"use client";

import { AssetLogo } from "@/components/markets/AssetLogo";
import type { ExternalMarket } from "@/types/application";

const NETWORK_ASSET_LOGOS: Readonly<Record<string, string>> = {
  USDG: "/asset-logo/USDG",
  WETH: "/asset-logo/WETH",
  ETH: "/asset-logo/ETH",
};

export function shieldedTokenLogoUrl(
  symbol: string,
  markets: readonly ExternalMarket[],
) {
  const normalized = symbol.toUpperCase();
  return (
    NETWORK_ASSET_LOGOS[normalized] ??
    markets.find((market) => market.symbol.toUpperCase() === normalized)
      ?.logoUrl ??
    null
  );
}

export function ShieldedTokenLogo({
  symbol,
  markets,
  className,
}: {
  symbol: string;
  markets: readonly ExternalMarket[];
  className?: string;
}) {
  return (
    <AssetLogo
      url={shieldedTokenLogoUrl(symbol, markets)}
      label={symbol}
      className={className}
    />
  );
}
