import type { MarketPricePoint } from "@/types/application";

export type PriceSource = "swap" | "oracle" | "reference";
export type ChartRange = "5m" | "15m" | "30m" | "1H" | "1D" | "1W" | "1M";
export type ChartInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type ChartStyle = "line" | "candles";
export const chartRangeForInterval: Record<ChartInterval, ChartRange> = {
  "1m": "1D",
  "5m": "1W",
  "15m": "1W",
  "30m": "1W",
  "1h": "1M",
  "4h": "1M",
  "1d": "1M",
};
export const chartRangeHours: Record<ChartRange, number> = {
  "5m": 5 / 60,
  "15m": 15 / 60,
  "30m": 0.5,
  "1H": 1,
  "1D": 24,
  "1W": 168,
  "1M": 720,
};
export const chartIntervals: Record<ChartInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
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

export type MarketVolumeBar = { time: number; value: number; color: string };

/** Quote-token traded volume only; oracle reports and rolling daily totals are not bar volume. */
export function marketVolumes(
  items: readonly MarketPricePoint[],
  interval: ChartInterval,
  inverted = false,
): MarketVolumeBar[] {
  const totals = new Map<number, number>();
  for (const item of items) {
    if (item.source !== "swap" || item.volume === null) continue;
    const timestamp = Date.parse(item.observedAt) / 1000;
    const raw = Number(item.volume);
    const price = Number(item.price);
    const volume = inverted ? raw / price : raw;
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(raw) ||
      raw < 0 ||
      !Number.isFinite(volume) ||
      volume < 0
    )
      continue;
    const time =
      Math.floor(timestamp / chartIntervals[interval]) *
      chartIntervals[interval];
    const sum = (totals.get(time) ?? 0) + volume;
    if (Number.isFinite(sum)) totals.set(time, sum);
  }
  return marketCandles(items, interval, inverted)
    .filter((bar) => totals.has(bar.time))
    .map((bar) => ({
      time: bar.time,
      value: totals.get(bar.time)!,
      color: bar.close >= bar.open ? "#56d9ad99" : "#f07b8799",
    }));
}

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
