"use client";

import { Activity, Database, Radio } from "lucide-react";
import { useMemo, useState } from "react";

import { RealDataState } from "@/components/protocol/real-data-state";
import { cx } from "@/lib/format";
import {
  type PriceSource,
  type ChartRange,
  useMarketPriceHistory,
} from "@/lib/use-market-price-history";

const width = 800;
const height = 220;
const padding = 16;

export function MarketPriceChart({ marketId, poolAddress = null, pairLabel, inverted = false }: {
  marketId: string | null; poolAddress?: string | null; pairLabel?: string; inverted?: boolean;
}) {
  const [source, setSource] = useState<PriceSource>("swap");
  const [range, setRange] = useState<ChartRange>("1W");
  const { items, loading, error, refresh } = useMarketPriceHistory(
    marketId,
    source,
    range,
    poolAddress,
  );
  const observations = useMemo(() => items.map((item) => ({ ...item,
    price: source === "swap" && poolAddress && inverted ? String(1 / Number(item.price)) : item.price,
  })), [items, source, poolAddress, inverted]);
  const points = useMemo(() => chartPoints(observations), [observations]);
  const latest = observations.at(-1);

  return (
    <section className="flex min-h-[24rem] flex-1 flex-col p-4" aria-label="Market chart">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Market chart · {range}
          </p>
          <p className="mt-1 text-xs text-muted">
            Swap observations and verified oracle reports remain separate.
          </p>
        </div>
        <div className="panel-inset flex p-1" role="tablist">
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
              role="tab"
              aria-selected={source === value}
              onClick={() => setSource(value)}
              className={cx(
                "flex h-9 cursor-pointer items-center gap-2 px-3 font-mono text-[10px] uppercase tracking-[0.1em]",
                source === value
                  ? "bg-lime text-lime-ink"
                  : "text-muted hover:text-fg",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 font-mono text-xs text-muted">
        {source === "swap" && poolAddress ? `Executed pool prices · ${pairLabel ?? "token1 per token0"}` : `${source === "oracle" ? "Verified oracle reports" : "Provider reference prices"} · USD denomination`}
        {latest ? ` · Latest ${Number(latest.price).toLocaleString("en-US", { maximumSignificantDigits: 8 })} · ${new Date(latest.observedAt).toLocaleString()}` : ""}
      </p>
      <div
        className="mt-3 flex items-center gap-1"
        role="group"
        aria-label="Chart timeframe"
      >
        {(["1H", "1D", "1W"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={range === value}
            onClick={() => setRange(value)}
            className={`h-8 cursor-pointer px-3 font-mono text-xs ${range === value ? "bg-raised text-lime" : "text-muted"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="mt-4 flex min-h-64 flex-1 flex-col justify-center">
        <RealDataState
          loading={loading}
          error={error}
          empty={false}
          onRetry={refresh}
        />
        {!loading && !error && !points.length && (
          <p className="border border-line px-4 py-8 text-sm leading-relaxed text-muted">
            {marketId || (source === "swap" && poolAddress)
              ? `No ${source} prices in this timeframe. Try another source or timeframe.`
              : "No validated feed is linked to this asset for the selected source."}
          </p>
        )}
        {!!points.length && (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${source} price history`}
            className="min-h-64 w-full flex-1 overflow-visible"
            preserveAspectRatio="none"
          >
            <path
              d={`M ${padding} ${height - padding} H ${width - padding}`}
              className="stroke-line"
              fill="none"
            />
            <polyline
              points={points}
              fill="none"
              className="stroke-lime"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {points.trim().split(" ").length === 1 && (
              <circle
                cx={points.trim().split(",")[0]}
                cy={points.trim().split(",")[1]}
                r="3"
                className="fill-lime"
              />
            )}
          </svg>
        )}
      </div>
    </section>
  );
}

function chartPoints(
  items: readonly Readonly<{ observedAt: string; price: string }>[],
) {
  const valid = items
    .map((item) => ({
      time: Date.parse(item.observedAt),
      price: Number(item.price),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.time) &&
        Number.isFinite(item.price) &&
        item.price > 0,
    );
  if (!valid.length) return "";
  const minTime = Math.min(...valid.map((item) => item.time));
  const maxTime = Math.max(...valid.map((item) => item.time));
  const minPrice = Math.min(...valid.map((item) => item.price));
  const maxPrice = Math.max(...valid.map((item) => item.price));
  return valid
    .map((item, index) => {
      const x =
        maxTime === minTime
          ? width / 2
          : padding +
            ((item.time - minTime) / (maxTime - minTime)) *
              (width - padding * 2);
      const y =
        maxPrice === minPrice
          ? height / 2
          : height -
            padding -
            ((item.price - minPrice) / (maxPrice - minPrice)) *
              (height - padding * 2);
      return `${index ? " " : ""}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join("");
}
