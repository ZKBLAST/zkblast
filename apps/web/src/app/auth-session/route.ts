function apiTarget(path: string): string | null {
  const configured = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!configured) return null;
  try {
    const target = new URL(configured);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    return `${target.toString().replace(/\/$/u, "")}${path}`;
  } catch {
    return null;
  }
}

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json",
  vary: "cookie",
};

export async function GET(request: Request) {
  const profileUrl = apiTarget("/v1/me");
  const tradesUrl = apiTarget("/v1/me/trades?limit=25");
  if (!profileUrl || !tradesUrl)
    return Response.json(
      { authenticated: false, unavailable: true },
      { status: 503, headers: responseHeaders },
    );

  const cookie = request.headers.get("cookie") ?? "";
  const profileResponse = await fetch(profileUrl, {
    cache: "no-store",
    headers: { accept: "application/json", cookie },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (profileResponse?.status === 401)
    return Response.json(
      { authenticated: false },
      { headers: responseHeaders },
    );
  if (!profileResponse?.ok)
    return Response.json(
      { authenticated: false, unavailable: true },
      { status: 503, headers: responseHeaders },
    );

  const tradesResponse = await fetch(tradesUrl, {
    cache: "no-store",
    headers: { accept: "application/json", cookie },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!tradesResponse?.ok)
    return Response.json(
      { authenticated: false, unavailable: true },
      { status: 503, headers: responseHeaders },
    );

  const profile: unknown = await profileResponse.json();
  const trades: unknown = await tradesResponse.json();
  return Response.json(
    {
      authenticated: true,
      profile,
      trades,
    },
    { headers: responseHeaders },
  );
}
