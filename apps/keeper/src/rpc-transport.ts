import { fallback, http } from "viem";

export function keeperRpcUrls(
  primaryUrl: string,
  configuredFallbacks: string | undefined,
  chainDefaults: readonly string[],
): string[] {
  const configured = configuredFallbacks
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const fallbackUrls = configured.length > 0 ? configured : chainDefaults;
  return [...new Set([primaryUrl, ...fallbackUrls])];
}

export function createKeeperTransport(urls: readonly string[]) {
  const transports = urls.map((url) =>
    http(url, { timeout: 20_000, retryCount: 1, retryDelay: 1_000 }),
  );
  return transports.length === 1
    ? transports[0]!
    : fallback(transports, { rank: true, retryCount: 2, retryDelay: 1_000 });
}
