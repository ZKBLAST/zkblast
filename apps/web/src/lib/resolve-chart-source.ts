import type { MarketPricePoint } from "../types/application";
import type { PriceSource } from "./market-chart-data";

export async function resolveChartSource(
  requested: PriceSource | "auto",
  load: (source: PriceSource) => Promise<MarketPricePoint[]>,
) {
  const source = requested === "auto" ? "oracle" : requested;
  const items = await load(source);
  if (requested === "auto" && items.length === 0) {
    return { source: "reference" as const, items: await load("reference") };
  }
  return { source, items };
}
