import { seeded } from "./pools";

export type Point = { t: string; v: number };

function series(seed: number, days: number, start: number, drift: number, vol: number): Point[] {
  const rand = seeded(seed);
  const out: Point[] = [];
  let v = start;
  const end = new Date("2026-10-17T00:00:00Z").getTime();
  for (let i = days - 1; i >= 0; i--) {
    v = Math.max(start * 0.2, v * (1 + drift + (rand() - 0.5) * vol));
    out.push({ t: new Date(end - i * 86_400_000).toISOString().slice(0, 10), v });
  }
  return out;
}

export const tvlSeries = series(11, 90, 52_000_000, 0.0042, 0.03);
export const volumeSeries = series(23, 90, 31_000_000, 0.003, 0.4);
export const feesSeries = volumeSeries.map((p, i) => ({ t: p.t, v: p.v * (0.00042 + ((i * 7) % 5) * 0.00002) }));
export const shieldedDepositsSeries = series(37, 30, 12, 0.03, 0.9).map((p) => ({ ...p, v: Math.round(p.v) }));

export const summary = {
  tvlUsd: tvlSeries[tvlSeries.length - 1].v,
  tvlChange7d: 6.42,
  volume24hUsd: volumeSeries[volumeSeries.length - 1].v,
  volumeChange: -3.18,
  fees24hUsd: feesSeries[feesSeries.length - 1].v,
  feesChange: 2.04,
  uniqueTraders24h: 4_317,
  swaps24h: 28_904,
};

export const typeSplit = [
  { label: "DLMM", v: 42_074_315 },
  { label: "DAMM", v: 37_565_957 },
];

export type Activity = {
  id: string;
  kind: "Swap" | "Add" | "Remove" | "Claim" | "Shielded deposit" | "Shielded withdraw";
  lane: "public" | "shielded";
  summary: string;
  valueUsd: number | null;
  ago: string;
};

export const activity: Activity[] = [
  { id: "a1", kind: "Swap", lane: "public", summary: "2.1 WETH for 7,164.30 USDC", valueUsd: 7_165.6, ago: "12s" },
  { id: "a2", kind: "Shielded deposit", lane: "shielded", summary: "1,000 USDC into vault", valueUsd: 1_000, ago: "41s" },
  { id: "a3", kind: "Add", lane: "public", summary: "WBTC/USDC, 22 bins", valueUsd: 25_400, ago: "1m" },
  { id: "a4", kind: "Swap", lane: "public", summary: "18,000 USDT for 17,993.2 USDC", valueUsd: 17_994, ago: "2m" },
  { id: "a5", kind: "Claim", lane: "public", summary: "Fees from UNI/USDC", valueUsd: 41.1, ago: "3m" },
  { id: "a6", kind: "Shielded withdraw", lane: "shielded", summary: "1 WETH to a fresh address", valueUsd: 3_412, ago: "5m" },
  { id: "a7", kind: "Remove", lane: "public", summary: "ETH/USDT, 100%", valueUsd: 9_820, ago: "7m" },
  { id: "a8", kind: "Swap", lane: "public", summary: "540 LINK for 2.27 WETH", valueUsd: 7_760, ago: "9m" },
];
