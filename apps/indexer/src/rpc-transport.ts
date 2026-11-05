import { fallback, http } from "viem";

export function parseRpcFallbackUrls(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const urls = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const value of urls) {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost")
      throw new Error("INDEXER_RPC_FALLBACK_URL_INVALID");
  }
  return [...new Set(urls)];
}

export function resolveRpcFallbackUrls(
  configuredValue: string | undefined,
  chainDefaults: readonly string[],
): string[] {
  const configured = parseRpcFallbackUrls(configuredValue);
  return configured.length > 0 ? configured : [...chainDefaults];
}

/** Keep endpoints that support both historical logs and block-tagged calls. */
export function resolveHistoricalRpcFallbackUrls(
  chainId: number,
  urls: readonly string[],
): string[] {
  if (chainId !== 4_663) return [...urls];
  const incompatibleHosts = new Set([
    "robinhood-rpc.publicnode.com",
    "robinhood.drpc.org",
  ]);
  return urls.filter((value) => !incompatibleHosts.has(new URL(value).hostname));
}

export function createIndexerTransport(
  primaryUrl: string,
  fallbackUrls = parseRpcFallbackUrls(process.env.RPC_FALLBACK_URLS),
) {
  const transports = [primaryUrl, ...fallbackUrls.filter((url) => url !== primaryUrl)].map(
    (url) => http(url, { timeout: 20_000, retryCount: 1, retryDelay: 1_000 }),
  );
  return transports.length === 1
    ? transports[0]!
    : fallback(transports, { rank: true, retryCount: 2, retryDelay: 1_000 });
}
