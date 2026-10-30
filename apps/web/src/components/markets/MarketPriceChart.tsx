"use client";

import {
  Activity,
  ChartCandlestick,
  ChartLine,
  Database,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
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
  type PriceSource,
} from "@/lib/market-chart-data";
import { useMarketPriceHistory } from "@/lib/use-market-price-history";
import { PriceHistoryCanvas } from "./PriceHistoryCanvas";

export function MarketPriceChart({
  marketId,
  poolAddress = null,
  pairLabel,
  inverted = false,
  perpsMarketId = null,
}: {
  marketId: string | null;
  poolAddress?: string | null;
  pairLabel?: string;
  inverted?: boolean;
  perpsMarketId?: string | null;
}) {
  const [selection, setSelection] = useState<{
    market: string;
    source: PriceSource;
  } | null>(null);
  const marketKey = `${marketId}:${poolAddress}`;
  const requestedSource =
    selection?.market === marketKey ? selection.source : "auto";
  const [interval, setInterval] = useState<ChartInterval>("1h");
  const range = chartRangeForInterval[interval];
  const [style, setStyle] = useState<ChartStyle>("line");
  const { items, loading, error, refresh, source } = useMarketPriceHistory(
    marketId,
    requestedSource,
    range,
    poolAddress,
    perpsMarketId,
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
        <div
          role="group"
          aria-label="Chart timeframe"
          className="flex flex-wrap gap-1"
        >
          {(Object.keys(chartIntervals) as ChartInterval[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setInterval(value)}
              className={`border px-2 py-2 font-mono text-xs ${interval === value ? "border-lime bg-lime text-lime-ink font-bold" : "border-transparent text-muted hover:border-line"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SelectMenu<ChartStyle>
            label="Chart style"
            value={style}
            onChange={setStyle}
            options={[
              { value: "line", label: "Line", icon: ChartLine },
              { value: "candles", label: "Candles", icon: ChartCandlestick },
            ]}
          />
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
            limited={items.length >= 2000}
            style={style}
            label={`${source} ${style} chart · ${unit ?? "provider denomination"}`}
          />
        )}
      </div>
    </section>
  );
}
