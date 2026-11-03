export function assetLogoUrl(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized === "HYPE" || normalized === "WHYPE")
    return "/images/networks/hyperliquid.png";
  return `/asset-logo/${encodeURIComponent(normalized)}`;
}
