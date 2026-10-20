import type { ExternalMarket, ProtocolPool } from "@/types/application";

export type PoolTokenOption = Readonly<{
  id: string;
  address: string | null;
  symbol: string;
  name: string;
  logoUrl: string | null;
}>;

function tokenAddress(value: string | null) {
  if (!value || !/^0x[\da-f]{40}$/iu.test(value)) return null;
  const normalized = value.toLowerCase();
  return /^0x(?:0{40}|e{40})$/u.test(normalized) ? null : normalized;
}

export function poolCreationTokens(
  pools: readonly ProtocolPool[],
  markets: readonly ExternalMarket[],
  chainId?: number,
): PoolTokenOption[] {
  if (!chainId) return [];
  const options = new Map<string, PoolTokenOption>();
  const add = (
    symbol: string,
    name: string,
    value: string | null,
    logoUrl: string | null,
  ) => {
    const address = tokenAddress(value);
    if (!address) return;
    const existing = options.get(address);
    options.set(address, {
      id: address,
      address,
      symbol,
      name,
      logoUrl: logoUrl ?? existing?.logoUrl ?? null,
    });
  };
  for (const market of markets) {
    const routes = market.pairCandidates.filter(
      (route) =>
        route.executionChainId === chainId && route.routeStatus !== "disabled",
    );
    const base =
      market.chainId === chainId
        ? tokenAddress(market.contractAddress)
        : (routes
            .map((route) => tokenAddress(route.baseAddress))
            .find(Boolean) ?? null);
    if (base) add(market.symbol, market.name, base, market.logoUrl);
    else
      options.set(`unavailable:${market.id}`, {
        id: `unavailable:${market.id}`,
        address: null,
        symbol: market.symbol,
        name: market.name,
        logoUrl: market.logoUrl,
      });
    for (const route of routes) {
      // Native ETH has no ERC20 contract; never substitute WETH implicitly.
      if (route.quoteSymbol !== "ETH")
        add(
          route.quoteSymbol,
          route.quoteSymbol,
          route.quoteAddress,
          route.logoUrl,
        );
    }
  }
  for (const pool of pools) {
    if (Number(pool.chainId) !== chainId) continue;
    for (const token of [
      { symbol: pool.token0Symbol, address: pool.token0Address },
      { symbol: pool.token1Symbol, address: pool.token1Address },
    ]) {
      const address = tokenAddress(token.address);
      if (!address || options.has(address)) continue;
      add(token.symbol, token.symbol, address, null);
    }
  }
  return [...options.values()].sort(
    (a, b) =>
      Number(!a.address) - Number(!b.address) ||
      a.symbol.localeCompare(b.symbol) ||
      a.id.localeCompare(b.id),
  );
}
