"use client";

import {
  Activity,
  ChartCandlestick,
  ChartLine,
  Database,
  Clock3,
  Maximize2,
  Minimize2,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { RealDataState } from "@/components/protocol/real-data-state";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { cx } from "@/lib/format";
import {
  chartRangeForInterval,
  chartIntervals,
  formatChartPrice,
  marketCandles,
  marketVolumes,
  type ChartInterval,
  type ChartStyle,
  type ChartPositionLine,
  type PriceSource,
} from "@/lib/market-chart-data";
import { useMarketPriceHistory } from "@/lib/use-market-price-history";
import { useChartPreferences } from "@/lib/use-chart-preferences";
import type { ChartIndicator } from "@/lib/use-chart-preferences";
import { PriceHistoryCanvas } from "./PriceHistoryCanvas";

export function MarketPriceChart({
  marketId,
  poolAddress = null,
  pairLabel,
  inverted = false,
  perpsMarketId = null,
  positionLines = [],
}: {
  marketId: string | null;
  poolAddress?: string | null;
  pairLabel?: string;
  inverted?: boolean;
  perpsMarketId?: string | null;
  positionLines?: readonly ChartPositionLine[];
}) {
  const [selection, setSelection] = useState<{
    market: string;
    source: PriceSource;
  } | null>(null);
  const marketKey = `${marketId}:${poolAddress}`;
  const defaultSource: PriceSource | "auto" = poolAddress ? "swap" : "auto";
  const requestedSource =
    selection?.market === marketKey ? selection.source : defaultSource;
  const { preferences, update: updatePreferences } = useChartPreferences();
  const interval = preferences.interval;
  const range = chartRangeForInterval[interval];
  const styleSelection = preferences.style;
  const selectedIndicators = preferences.indicators;
  const root = useRef<HTMLElement>(null);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const { items, loading, error, refresh, source } = useMarketPriceHistory(
    marketId,
    requestedSource,
    range,
    poolAddress,
    perpsMarketId,
  );
  const style = styleSelection ?? (source === "swap" && poolAddress ? "candles" : "line");
  const bars = useMemo(
    () =>
      marketCandles(
        items,
        interval,
        source === "swap" && Boolean(poolAddress) && inverted,
        source === "swap" && Boolean(poolAddress),
      ),
    [items, interval, source, poolAddress, inverted],
  );
  const volumes = useMemo(
    () =>
      marketVolumes(
        items,
        interval,
        source === "swap" && Boolean(poolAddress) && inverted,
      ),
    [items, interval, source, poolAddress, inverted],
  );
  const unit =
    source === "swap" && poolAddress
      ? (pairLabel?.split("/")[1] ?? "quote token")
      : (items.find((item) => item.priceUnit)?.priceUnit ?? null);
  const latest = bars.at(-1);
  const observedAt = items
    .map((item) => Date.parse(item.observedAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1);
  const available =
    source === "swap" ? Boolean(poolAddress) : Boolean(marketId);
  const chartKey = `${marketId}:${poolAddress}:${source}:${range}:${interval}`;
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
        "flex min-h-[30rem] flex-1 flex-col bg-bg p-4",
        fallbackFullscreen && "fixed inset-0 z-[100] min-h-0 overflow-auto",
      )}
      aria-label="Market chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Market chart</p>
          <p className="mt-2 font-mono text-lg">
            {latest
              ? `${formatChartPrice(latest.close)} ${unit ?? "reported units"}`
              : "—"}
          </p>
          <p className="mt-1 text-[10px] text-muted">
            {source === "swap"
              ? "Executed ZKBLAST pool trades"
              : source === "oracle"
                ? "Validated oracle reports"
                : "External market reference"}
            {observedAt
              ? ` · Last observation ${new Date(observedAt).toLocaleString()}`
              : ""}
          </p>
        </div>
        <div
          className="panel-inset flex flex-wrap p-1"
          role="group"
          aria-label="Chart data source"
        >
          {(
            [
              ["swap", "Swap", Activity],
              ["oracle", "Oracle", Radio],
              ["reference", "Reference", Database],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              onClick={() => setSelection({ market: marketKey, source: value })}
              className={cx(
                "flex h-9 items-center gap-2 px-3 font-mono text-[10px] uppercase",
                source === value
                  ? "bg-lime text-lime-ink ring-1 ring-lime font-bold shadow-[0_0_12px_#dfe2ed33]"
                  : "text-muted hover:text-fg",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-line py-2">
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
        <div className="flex items-center gap-2">
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
            aria-label={fallbackFullscreen || nativeFullscreen ? "Exit fullscreen" : "Open fullscreen"}
            onClick={() => void toggleFullscreen()}
            className="p-2"
          >
            {fallbackFullscreen || nativeFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Refresh chart"
            disabled={loading}
            onClick={() => void refresh()}
            className="p-2"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden
            />
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
      <div className="mt-3 flex min-h-80 flex-1 flex-col">
        <RealDataState
          loading={loading}
          error={error}
          empty={false}
          onRetry={refresh}
        />
        {!loading && !error && !bars.length && (
          <p className="my-auto border border-line p-5 text-sm text-muted">
            {!available
              ? source === "swap"
                ? "Select a market with a validated ZKBLAST pool to view its executed trades."
                : "No market feed is linked to this asset."
              : source === "oracle"
                ? "No validated oracle reports in this period. Some assets do not have an independent oracle feed."
                : `No recorded ${source} observations in this period. Try a wider timeframe or another source.`}
          </p>
        )}
        {bars.length > 0 && (
          <PriceHistoryCanvas
            key={chartKey}
            bars={bars}
            volumes={volumes}
            volumeUnit={unit}
            limited={items.length >= 2000}
            style={style}
            label={`${source} ${style} chart · ${unit ?? "provider denomination"}`}
            positionLines={positionLines}
            indicators={selectedIndicators}
          />
        )}
      </div>
    </section>
  );
}
