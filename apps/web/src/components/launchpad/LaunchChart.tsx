"use client";
import {
  ChartCandlestick,
  ChartLine,
  Clock3,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PriceHistoryCanvas } from "@/components/markets/PriceHistoryCanvas";
import { Skeleton } from "@/components/ui/Skeleton";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { cx } from "@/lib/format";
import type {
  ChartInterval,
  ChartStyle,
  MarketCandle,
  MarketVolumeBar,
} from "@/lib/market-chart-data";
import { chartIntervals } from "@/lib/market-chart-data";
import {
  useChartPreferences,
  type ChartIndicator,
} from "@/lib/use-chart-preferences";
import type { DbcCandle } from "./types";

export function LaunchChart({
  launchId,
  symbol,
  quoteSymbol,
  quoteDecimals,
  refreshKey,
}: {
  launchId: string;
  symbol: string;
  quoteSymbol: string;
  quoteDecimals: number;
  refreshKey?: string;
}) {
  const { preferences, update: updatePreferences } = useChartPreferences();
  const interval = preferences.interval;
  const style: ChartStyle = preferences.style ?? "line";
  const selectedIndicators = preferences.indicators;
  const [items, setItems] = useState<readonly DbcCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const loadedLaunch = useRef("");
  const root = useRef<HTMLElement>(null);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const firstLoad = loadedLaunch.current !== launchId;
    if (firstLoad) setLoading(true);
    setError("");
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400_000);
    void apiRequest<{ items: DbcCandle[] }>(
      webPublicConfig.apiUrl,
      `/v1/dbc/launches/${launchId}/candles?interval=${interval}&from=${from.toISOString()}&to=${to.toISOString()}&limit=2000`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((result) => setItems(result.items))
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "CHART_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          loadedLaunch.current = launchId;
          setLoading(false);
        }
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
          value: Number(item.quote_volume_raw) / 10 ** quoteDecimals,
          color:
            Number(item.close_x18) >= Number(item.open_x18)
              ? "#56d9ad99"
              : "#f07b8799",
        }))
        .filter((item) => Number.isFinite(item.value) && item.value > 0),
    [items, quoteDecimals],
  );
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setNativeFullscreen(false);
      return;
    }
    if (root.current?.requestFullscreen) {
      await root.current.requestFullscreen();
      setNativeFullscreen(true);
      return;
    }
    setFallbackFullscreen((value) => !value);
  }
  function toggleIndicator(indicator: ChartIndicator) {
    updatePreferences({
      indicators: selectedIndicators.includes(indicator)
        ? selectedIndicators.filter((value) => value !== indicator)
        : [...selectedIndicators, indicator],
    });
  }
  return (
    <section
      ref={root}
      className={cx(
        "flex min-h-[28rem] flex-col bg-bg p-4 sm:p-5",
        fallbackFullscreen && "fixed inset-0 z-[100] min-h-0 overflow-auto",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="label">Curve market chart</p>
          <p className="mt-1 text-xs text-muted">
            Executed {symbol}/{quoteSymbol} curve trades
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectMenu<ChartInterval>
            label="Chart interval"
            value={interval}
            onChange={(value) => updatePreferences({ interval: value })}
            options={(Object.keys(chartIntervals) as ChartInterval[]).map((value) => ({
              value,
              label: value,
              icon: Clock3,
            }))}
          />
          <SelectMenu<ChartStyle>
            label="Chart style"
            value={style}
            onChange={(value) => updatePreferences({ style: value })}
            options={[
              { value: "line", label: "Line", icon: ChartLine },
              { value: "candles", label: "Candles", icon: ChartCandlestick },
            ]}
          />
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={fallbackFullscreen || nativeFullscreen ? "Exit fullscreen" : "Open fullscreen"}
            className="border border-line p-2"
          >
            {fallbackFullscreen || nativeFullscreen
              ? <Minimize2 className="size-4" />
              : <Maximize2 className="size-4" />}
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
      <div className="flex flex-wrap gap-1 border-b border-line py-2" role="group" aria-label="Chart indicators">
        {([
          ["ma20", "MA 20"],
          ["ema50", "EMA 50"],
          ["vwap", "VWAP"],
          ["bb20", "Bollinger"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={selectedIndicators.includes(value)}
            onClick={() => toggleIndicator(value)}
            className={cx(
              "border px-2.5 py-1 font-mono text-[9px] uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime",
              selectedIndicators.includes(value)
                ? "border-lime bg-lime/10 text-lime"
                : "border-line text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
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
          volumeUnit={quoteSymbol}
          style={style}
          label={`${symbol}/${quoteSymbol} curve chart`}
          indicators={selectedIndicators}
        />
      ) : (
        <div className="my-auto border border-line p-5 text-sm text-muted">
          No validated curve swaps in this period.
        </div>
      )}
    </section>
  );
}
