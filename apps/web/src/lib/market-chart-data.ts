import type { MarketPricePoint } from "@/types/application";

export type PriceSource = "swap" | "oracle" | "reference";
export type ChartRange = "1H" | "1D" | "1W" | "1M";
export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type ChartStyle = "line" | "candles";
export const chartRangeHours: Record<ChartRange, number> = {
  "1H": 1,
  "1D": 24,
  "1W": 168,
  "1M": 720,
};
export const chartIntervals: Record<ChartInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  observations: number;
};

/** Aggregate only recorded observations; no gap filling or invented opening prices. */
export function marketCandles(
  items: readonly MarketPricePoint[],
  interval: ChartInterval,
  inverted = false,
): MarketCandle[] {
  const samples = items
    .map((item, index) => ({
      time: Date.parse(item.observedAt) / 1000,
      price: inverted ? 1 / Number(item.price) : Number(item.price),
      index,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.time) &&
        item.time > 0 &&
        Number.isFinite(item.price) &&
        item.price > 0,
    )
    .sort((a, b) => a.time - b.time || a.index - b.index);
  const candles = new Map<number, MarketCandle>();
  for (const sample of samples) {
    const time =
      Math.floor(sample.time / chartIntervals[interval]) *
      chartIntervals[interval];
    const candle = candles.get(time);
    if (candle) {
      candle.high = Math.max(candle.high, sample.price);
      candle.low = Math.min(candle.low, sample.price);
      candle.close = sample.price;
      candle.observations++;
    } else
      candles.set(time, {
        time,
        open: sample.price,
        high: sample.price,
        low: sample.price,
        close: sample.price,
        observations: 1,
      });
  }
  return [...candles.values()];
}

export function formatChartPrice(value: number) {
  return value.toLocaleString("en-US", { maximumSignificantDigits: 8 });
}
