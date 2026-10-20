"use client";

import { Activity, Database, Radio, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { RealDataState } from "@/components/protocol/real-data-state";
import { cx } from "@/lib/format";
import {
  chartIntervals,
  formatChartPrice,
  marketCandles,
  marketVolumes,
  type ChartInterval,
  type ChartRange,
  type ChartStyle,
  type PriceSource,
} from "@/lib/market-chart-data";
import { useMarketPriceHistory } from "@/lib/use-market-price-history";
import { PriceHistoryCanvas } from "./PriceHistoryCanvas";

export function MarketPriceChart({
  marketId,
  poolAddress = null,
  pairLabel,
  inverted = false,
}: {
  marketId: string | null;
  poolAddress?: string | null;
  pairLabel?: string;
  inverted?: boolean;
}) {
  const [source, setSource] = useState<PriceSource>(
    poolAddress ? "swap" : "reference",
  );
  const [range, setRange] = useState<ChartRange>("1W");
  const [interval, setInterval] = useState<ChartInterval>("1h");
  const [style, setStyle] = useState<ChartStyle>("candles");
  const { items, loading, error, refresh } = useMarketPriceHistory(
    marketId,
    source,
    range,
    poolAddress,
  );
  const bars = useMemo(
    () =>
      marketCandles(
        items,
        interval,
        source === "swap" && Boolean(poolAddress) && inverted,
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
  return (
    <section
      className="flex min-h-[30rem] flex-1 flex-col p-4"
      aria-label="Market chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Market chart · {range}</p>
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
              onClick={() => setSource(value)}
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
        <div
          role="group"
          aria-label="Chart timeframe"
          className="flex flex-wrap gap-1"
        >
          {(["5m", "15m", "30m", "1H", "1D", "1W", "1M"] as const).map(
            (value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => {
                  setRange(value);
                  if (["5m", "15m", "30m"].includes(value)) setInterval("1m");
                }}
                className={`border px-2 py-2 font-mono text-xs ${range === value ? "border-lime bg-lime text-lime-ink font-bold" : "border-transparent text-muted hover:border-line"}`}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">
            Interval{" "}
            <select
              value={interval}
              onChange={(event) =>
                setInterval(event.target.value as ChartInterval)
              }
              className="border border-line bg-bg p-2 text-fg"
            >
              {Object.keys(chartIntervals).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="sr-only" htmlFor={`${chartKey}-style`}>
            Chart style
          </label>
          <select
            id={`${chartKey}-style`}
            value={style}
            onChange={(event) => setStyle(event.target.value as ChartStyle)}
            className="border border-line bg-bg p-2 text-xs"
          >
            <option value="candles">Candles</option>
            <option value="line">Line</option>
          </select>
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
            style={style}
            label={`${source} ${style} chart · ${unit ?? "provider denomination"}`}
          />
        )}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-faint">
        {items.length} observations · {bars.length} recorded intervals. Sources
        retain their own denomination; oracle/reference prices are not
        executable pool quotes.
        {items.length >= 2000
          ? " Showing the latest 2,000 observations; use a shorter period for finer detail."
          : ""}
      </p>
    </section>
  );
}
