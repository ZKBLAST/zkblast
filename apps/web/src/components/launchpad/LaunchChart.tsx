"use client";
import { ChartCandlestick, ChartLine, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PriceHistoryCanvas } from "@/components/markets/PriceHistoryCanvas";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import type {
  ChartStyle,
  MarketCandle,
  MarketVolumeBar,
} from "@/lib/market-chart-data";
import type { DbcCandle } from "./types";

const intervals = ["1m", "5m", "15m", "1h", "1d"] as const;
export function LaunchChart({
  launchId,
  symbol,
  refreshKey,
}: {
  launchId: string;
  symbol: string;
  refreshKey?: string;
}) {
  const [interval, setInterval] = useState<(typeof intervals)[number]>("1h");
  const [style, setStyle] = useState<ChartStyle>("line");
  const [items, setItems] = useState<readonly DbcCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400_000);
    void apiRequest<{ items: DbcCandle[] }>(
      webPublicConfig.apiUrl,
      `/v1/dbc/launches/${launchId}/candles?interval=${interval}&from=${from.toISOString()}&to=${to.toISOString()}&limit=2000`,
      { signal: controller.signal },
    )
      .then((result) => setItems(result.items))
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "CHART_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [launchId, interval, revision, refreshKey]);
  const bars = useMemo<MarketCandle[]>(
    () =>
      items
        .map((item) => ({
          time: Date.parse(item.bucket) / 1000,
          open: Number(item.open_x18) / 1e18,
          high: Number(item.high_x18) / 1e18,
          low: Number(item.low_x18) / 1e18,
          close: Number(item.close_x18) / 1e18,
          observations: item.trades,
        }))
        .filter((item) => Number.isFinite(item.close) && item.close > 0),
    [items],
  );
  const volumes = useMemo<MarketVolumeBar[]>(
    () =>
      items
        .map((item) => ({
          time: Date.parse(item.bucket) / 1000,
          value: Number(item.quote_volume_raw) / 1e6,
          color:
            Number(item.close_x18) >= Number(item.open_x18)
              ? "#56d9ad99"
              : "#f07b8799",
        }))
        .filter((item) => Number.isFinite(item.value) && item.value > 0),
    [items],
  );
  return (
    <section className="flex min-h-[28rem] flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="label">Curve market chart</p>
          <p className="mt-1 text-xs text-muted">
            Executed {symbol}/USDG curve trades
          </p>
        </div>
        <div className="flex items-center gap-1">
          {intervals.map((value) => (
            <button
              key={value}
              onClick={() => setInterval(value)}
              className={`border px-2 py-2 font-mono text-[10px] ${interval === value ? "border-lime bg-lime text-lime-ink" : "border-transparent text-muted hover:border-line"}`}
            >
              {value}
            </button>
          ))}
          <button
            onClick={() => setStyle((v) => (v === "line" ? "candles" : "line"))}
            aria-label="Change chart style"
            className="border border-line p-2"
          >
            {style === "line" ? (
              <ChartLine className="size-4" />
            ) : (
              <ChartCandlestick className="size-4" />
            )}
          </button>
          <button
            onClick={() => setRevision((v) => v + 1)}
            disabled={loading}
            aria-label="Refresh chart"
            className="border border-line p-2"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3 py-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : error ? (
        <div className="my-auto border border-danger/40 p-4 text-sm text-danger">
          Chart unavailable · {error}
        </div>
      ) : bars.length ? (
        <PriceHistoryCanvas
          bars={bars}
          volumes={volumes}
          volumeUnit="USDG"
          style={style}
          label={`${symbol}/USDG curve chart`}
        />
      ) : (
        <div className="my-auto border border-line p-5 text-sm text-muted">
          No validated curve swaps in this period.
        </div>
      )}
    </section>
  );
}
