function networkScopedPath(path: string): string {
  if (typeof window === "undefined") return path;
  if (!/^\/v1\/(protocol|dbc|launchpads)(?:\/|\?|$)/u.test(path))
    return path;
  const chainId = Number.parseInt(
    window.localStorage.getItem("zkblast.activeChainId") ?? "",
    10,
  );
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId === 4663)
    return path;
  return path.replace(/^\/v1\/(protocol|dbc|launchpads)/u, `/v2/chains/${chainId}/$1`);
}

export async function apiRequest<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl}${networkScopedPath(path)}`, {
    ...init,
    signal:
      init?.signal ??
      ((init?.method ?? "GET") === "GET"
        ? AbortSignal.timeout(20_000)
        : undefined),
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }

  return (response.status === 204 ? null : response.json()) as Promise<T>;
}
