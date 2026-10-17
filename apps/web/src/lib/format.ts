const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const fmtUsd = (v: number) => usd.format(v);
export const formatUsd = fmtUsd;
export const fmtUsdCompact = (v: number) => "$" + compact.format(v);
export const fmtPct = (v: number, signed = false) => `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}%`;

export function fmtAmount(v: number, maxDp?: number) {
  const abs = Math.abs(v);
  const dp = maxDp ?? (abs === 0 ? 2 : abs < 0.001 ? 7 : abs < 1 ? 5 : abs < 1000 ? 4 : 2);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: dp }).format(v);
}

export function fmtPrice(v: number) {
  if (v >= 1000) return fmtAmount(v, 2);
  if (v >= 1) return fmtAmount(v, 4);
  return fmtAmount(v, 7);
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return "0x" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const shortHex = (h: string, n = 4) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);
export const shortAddress = (value: string) => shortHex(value, 4);
