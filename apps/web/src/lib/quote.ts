import { pools, type Pool } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";

export type Quote = {
  out: number;
  rate: number;
  impact: number; // percent
  feeUsd: number;
  route: { pool: Pool; from: string; to: string }[];
  minOut: number;
};

const direct = (a: string, b: string) => pools.find((p) => (p.base === a && p.quote === b) || (p.base === b && p.quote === a));

export function quote(from: string, to: string, amount: number, slippagePct: number): Quote | null {
  if (!amount || amount <= 0 || from === to) return null;
  const a = tokenBySymbol(from), b = tokenBySymbol(to);
  let hops: { pool: Pool; from: string; to: string }[] = [];
  const d = direct(from, to);
  if (d) hops = [{ pool: d, from, to }];
  else {
    const mid = ["USDC", "WETH", "USDT"].find((m) => m !== from && m !== to && direct(from, m) && direct(m, to));
    if (!mid) return null;
    hops = [{ pool: direct(from, mid)!, from, to: mid }, { pool: direct(mid, to)!, from: mid, to }];
  }
  const usdIn = amount * a.priceUsd;
  const feeBps = hops.reduce((s, h) => s + h.pool.feeBps, 0);
  const impact = hops.reduce((s, h) => s + (usdIn / (h.pool.tvlUsd * (h.pool.type === "DLMM" ? 0.9 : 2.2))) * 100, 0);
  const rate = a.priceUsd / b.priceUsd;
  const out = amount * rate * (1 - feeBps / 10_000) * (1 - impact / 100);
  return { out, rate, impact, feeUsd: (usdIn * feeBps) / 10_000, route: hops, minOut: out * (1 - slippagePct / 100) };
}
