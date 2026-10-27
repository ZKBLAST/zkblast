import { readFile } from "node:fs/promises";
import path from "node:path";

const LOGO_SOURCES: Readonly<Record<string, string>> = {
  USDG: "https://mintcdn.com/paxos-0ac97319/ykAU2vouTvwgGjtD/images/usdg.png?fit=max&auto=format&n=ykAU2vouTvwgGjtD&q=85&s=3a2dfa481556c8322f0271baedb00afe",
  WETH: "https://images.cryptorank.io/coins/weth1701090834118.png",
  ETH: "https://metamask.io/_next/image?url=https%3A%2F%2Fpolymarket-upload.s3.us-east-2.amazonaws.com%2FETH%2Bfullsize.jpg&w=640&q=75",
};

const MAX_LOGO_BYTES = 5_000_000;

async function getLocalFallback(symbol: string): Promise<Response | null> {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "tokens",
      `${symbol.toLowerCase()}.png`,
    );
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-length": String(data.byteLength),
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const upperSymbol = symbol.toUpperCase();
  const source = LOGO_SOURCES[upperSymbol];
  if (!source) return new Response(null, { status: 404 });

  try {
    const upstream = await fetch(source, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        referer: "https://cryptorank.io/",
      },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0];
    if (!upstream.ok || !contentType?.startsWith("image/")) {
      const fallback = await getLocalFallback(upperSymbol);
      if (fallback) return fallback;
      return new Response(null, { status: 502 });
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength < 32 || bytes.byteLength > MAX_LOGO_BYTES) {
      const fallback = await getLocalFallback(upperSymbol);
      if (fallback) return fallback;
      return new Response(null, { status: 502 });
    }

    return new Response(bytes, {
      headers: {
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-length": String(bytes.byteLength),
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    const fallback = await getLocalFallback(upperSymbol);
    if (fallback) return fallback;
    return new Response(null, { status: 502 });
  }
}
