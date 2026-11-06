"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { fmtAmount } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";

type PoolStats = Readonly<{
  model: "damm" | "dlmm";
  priceUnit: string;
  quoteDecimals: number;
  spotPriceX18: string | null;
  tvlQuoteRaw: string | null;
  tvlCoverage: "full_pool" | "requires_dlmm_lens";
  fee24hRaw: string;
  feesToTvlBps: string | null;
  priceChange24hBps: string | null;
  poolAgeSeconds: string;
  asOfBlock: string | null;
  observedAt: string | null;
  windows: Record<string, {
    volumeQuoteRaw: string;
    buyCount: number;
    sellCount: number;
    buyVolumeRaw: string;
    sellVolumeRaw: string;
    netBuyRaw: string;
  }>;
}>;

export function PoolStatsStrip({ pool }: { pool: string }) {
  const [windowLabel, setWindowLabel] = useState<"5m" | "1h" | "6h" | "24h">("24h");
  const [state, setState] = useState<{
    pool: string;
    stats: PoolStats | null;
    loading: boolean;
    error: boolean;
  }>({ pool, stats: null, loading: true, error: false });
  const refresh = useCallback(async (background = false) => {
    if (!background) setState({ pool, stats: null, loading: true, error: false });
    try {
      const response = await apiRequest<{ stats: PoolStats | null }>(
        webPublicConfig.apiUrl,
        `/v1/protocol/pools/${encodeURIComponent(pool)}/stats`,
      );
      setState({ pool, stats: response.stats, loading: false, error: false });
    } catch {
      setState((previous) => previous.pool === pool
        ? { ...previous, loading: false, error: true }
        : { pool, stats: null, loading: false, error: true });
    }
  }, [pool]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const stats = state.pool === pool ? state.stats : null;
  if (state.loading)
    return (
      <div className="border-b border-line" role="status" aria-label="Loading pool statistics">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="space-y-2 border-r border-line px-3 py-2 last:border-r-0">
              <Skeleton className="h-2 w-12" />
              <Skeleton className="h-3 w-20 max-w-full" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
    );
  if (state.error || !stats)
    return (
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-xs text-muted">
        <p>Pool statistics are temporarily unavailable.</p>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 hover:text-fg">
          <RefreshCw className="size-3" aria-hidden /> Retry
        </button>
      </div>
    );
  const activity = stats.windows[windowLabel] ?? {
    volumeQuoteRaw: "0", buyCount: 0, sellCount: 0,
    buyVolumeRaw: "0", sellVolumeRaw: "0", netBuyRaw: "0",
  };
  const values = [
    ["Price", stats.spotPriceX18 ? `${formatFixed(stats.spotPriceX18, 18)} ${stats.priceUnit}` : "—"],
    ["24h", stats.priceChange24hBps === null ? "—" : `${signed(Number(stats.priceChange24hBps) / 100)}%`],
    ["TVL", stats.tvlQuoteRaw === null ? "Needs full bin range" : `${formatFixed(stats.tvlQuoteRaw, stats.quoteDecimals)} ${stats.priceUnit}`],
    [`Volume ${windowLabel}`, `${formatFixed(activity.volumeQuoteRaw, stats.quoteDecimals)} ${stats.priceUnit}`],
    ["Fee 24h", `${formatFixed(stats.fee24hRaw, stats.quoteDecimals)} ${stats.priceUnit}`],
    ["Fees / TVL", stats.feesToTvlBps === null ? "—" : `${fmtAmount(Number(stats.feesToTvlBps) / 100, 4)}%`],
    ["Pool age", formatAge(stats.poolAgeSeconds)],
  ] as const;
  const observedAgeMs = stats.observedAt
    ? Date.now() - Date.parse(stats.observedAt)
    : Number.POSITIVE_INFINITY;
  const stale = !Number.isFinite(observedAgeMs) || observedAgeMs > 5 * 60_000;
  return (
    <div className="border-b border-line" title={stats.asOfBlock ? `Finalized at block ${stats.asOfBlock}` : undefined}>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
        {values.map(([label, value], index) => (
          <div
            key={label}
            className={`min-w-0 border-r border-line px-3 py-2 last:border-r-0 ${index > 3 ? "pool-stat-secondary" : ""}`}
          >
            <p className="font-mono text-[9px] uppercase text-faint">{label}</p>
            <p className="mt-1 truncate font-mono text-[11px] text-fg" title={value}>{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5 font-mono text-[9px] uppercase text-muted">
        <div className="flex" role="group" aria-label="Pool activity window">
          {(["5m", "1h", "6h", "24h"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={windowLabel === value}
              onClick={() => setWindowLabel(value)}
              className={`px-2 py-1 ${windowLabel === value ? "bg-white/10 text-fg" : "hover:text-fg"}`}>
              {value}
            </button>
          ))}
        </div>
        <p>
          <span className="text-emerald-300">{activity.buyCount} buys · {formatFixed(activity.buyVolumeRaw, stats.quoteDecimals)}</span>
          {" / "}
          <span className="text-rose-300">{activity.sellCount} sells · {formatFixed(activity.sellVolumeRaw, stats.quoteDecimals)}</span>
          {" · Net "}{formatFixed(activity.netBuyRaw, stats.quoteDecimals)} {stats.priceUnit}
        </p>
        <p className={stale ? "text-amber-300" : "text-emerald-300"}>
          {stale ? "Last finalized state" : "Live finalized state"}
          {stats.asOfBlock ? ` · block ${stats.asOfBlock}` : ""}
        </p>
      </div>
    </div>
  );
}

function formatFixed(raw: string, decimals: number) {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals) || "0";
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/u, "").slice(0, 6);
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${fmtAmount(value, 2)}`;
}

function formatAge(rawSeconds: string) {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
