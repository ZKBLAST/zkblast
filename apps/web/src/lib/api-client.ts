export async function apiRequest<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
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
