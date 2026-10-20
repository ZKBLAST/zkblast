import { formatUnits, parseUnits } from "viem";

const SCALE = 10n ** 18n;
async function json(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Price provider returned ${response.status}`);
  return response.json() as Promise<unknown>;
}
function positive(value: unknown) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+(?:\.\d{1,18})?$/u.test(String(value))
  )
    throw new Error("Invalid reference price response");
  const raw = parseUnits(String(value), 18);
  if (raw <= 0n) throw new Error("Nonpositive reference price");
  return raw;
}
function coinbase(value: unknown, base: string) {
  const row = value as {
    data?: { amount?: unknown; base?: string; currency?: string };
  };
  if (row.data?.base !== base || row.data.currency !== "USD")
    throw new Error("Coinbase reference pair mismatch");
  return positive(row.data.amount);
}

export async function observeDlmmReference() {
  const [gecko, eth, dollar] = await Promise.all([
    json(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,global-dollar&vs_currencies=usd&include_last_updated_at=true",
    ),
    json("https://api.coinbase.com/v2/prices/ETH-USD/spot"),
    json("https://api.coinbase.com/v2/prices/USDG-USD/spot"),
  ]);
  const values = gecko as Record<
    string,
    { usd?: unknown; last_updated_at?: number }
  >;
  for (const symbol of ["ethereum", "global-dollar"]) {
    const timestamp = values[symbol]?.last_updated_at;
    const age = Date.now() / 1000 - (timestamp ?? 0);
    if (!Number.isFinite(age) || age < -60 || age > 900)
      throw new Error(`Stale ${symbol} price reference`);
  }
  const geckoEth = positive(values.ethereum?.usd);
  const geckoUsdg = positive(values["global-dollar"]?.usd);
  const coinbaseEth = coinbase(eth, "ETH");
  const coinbaseUsdg = coinbase(dollar, "USDG");
  const ratios = [
    (geckoEth * SCALE) / geckoUsdg,
    (coinbaseEth * SCALE) / coinbaseUsdg,
  ];
  const first = ratios[0]!;
  const second = ratios[1]!;
  const difference = first > second ? first - second : second - first;
  const divergenceBps = Number(
    (difference * 10_000n) / (first < second ? first : second),
  );
  if (divergenceBps > 100)
    throw new Error("ETH/USDG references diverge by more than 1 percent");
  for (const usdg of [geckoUsdg, coinbaseUsdg]) {
    if (usdg < (SCALE * 98n) / 100n || usdg > (SCALE * 102n) / 100n)
      throw new Error("USDG reference outside reviewed peg range");
  }
  return {
    observedAt: new Date().toISOString(),
    maximumAgeSeconds: 900,
    maximumDivergenceBps: 100,
    divergenceBps,
    wethPriceUsdg: formatUnits((first + second) / 2n, 18),
    sources: [
      {
        provider: "CoinGecko",
        ethUsd: formatUnits(geckoEth, 18),
        usdgUsd: formatUnits(geckoUsdg, 18),
        ethUpdatedAt: values.ethereum!.last_updated_at,
        usdgUpdatedAt: values["global-dollar"]!.last_updated_at,
      },
      {
        provider: "Coinbase",
        ethUsd: formatUnits(coinbaseEth, 18),
        usdgUsd: formatUnits(coinbaseUsdg, 18),
      },
    ],
  };
}
