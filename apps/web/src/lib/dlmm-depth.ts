import { formatUnits } from "viem";

export type DlmmDepthRow = Readonly<{
  binId: number;
  side: "bid" | "active" | "ask";
  price: number;
  base: number;
  quote: number;
  value: number;
  cumulative: number;
}>;

export function dlmmDepthRows(
  bins: readonly Readonly<{ binId: number; reserve0: string; reserve1: string; priceX18: string }>[],
  activeBin: number,
  baseDecimals: number,
  quoteDecimals: number,
  inverted = false,
): DlmmDepthRow[] {
  const normalized = [...bins].sort((a, b) => a.binId - b.binId).flatMap((bin) => {
    const canonicalPrice = Number(formatUnits(BigInt(bin.priceX18), 18));
    const reserve0 = Number(formatUnits(BigInt(bin.reserve0), baseDecimals));
    const reserve1 = Number(formatUnits(BigInt(bin.reserve1), quoteDecimals));
    const price = inverted ? 1 / canonicalPrice : canonicalPrice;
    const base = inverted ? reserve1 : reserve0;
    const quote = inverted ? reserve0 : reserve1;
    if (![price, base, quote].every(Number.isFinite) || price <= 0 || base < 0 || quote < 0) return [];
    return [{
      binId: bin.binId,
      side: bin.binId < activeBin ? "bid" as const : bin.binId > activeBin ? "ask" as const : "active" as const,
      price,
      base,
      quote,
      value: base * price + quote,
    }];
  });
  const totals = new Map<number, number>();
  for (const side of ["bid", "ask"] as const) {
    let total = 0;
    const sideRows = normalized.filter((row) => row.side === side).sort((a, b) => side === "bid" ? b.binId - a.binId : a.binId - b.binId);
    for (const row of sideRows) {
      total += row.value;
      totals.set(row.binId, total);
    }
  }
  return normalized.map((row) => ({
    ...row,
    cumulative: row.side === "active" ? row.value : (totals.get(row.binId) ?? row.value),
  }));
}
