"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { DlmmBins } from "@/lib/use-dlmm-bins";
import {
  dlmmRangeEvent,
  isDlmmRangeEvent,
  publishDlmmRange,
} from "@/lib/dlmm-range-events";

type Shape = "spot" | "curve" | "bid-ask";

export function DlmmShapePreview({
  data,
  selectedBin,
  disabled,
  onSelectBin,
  onPreviewOnlyChange,
}: {
  data: DlmmBins;
  selectedBin: number;
  disabled: boolean;
  onSelectBin: (bin: number) => void;
  onPreviewOnlyChange: (previewOnly: boolean) => void;
}) {
  const ordered = useMemo(() => [...data.bins].sort((a, b) => a.binId - b.binId), [data.bins]);
  const activeIndex = Math.max(0, ordered.findIndex((bin) => bin.binId === selectedBin));
  const [shape, setShape] = useState<Shape>("spot");
  const [lower, setLower] = useState(activeIndex);
  const [upper, setUpper] = useState(activeIndex);

  useEffect(() => onPreviewOnlyChange(shape !== "spot"), [onPreviewOnlyChange, shape]);
  useEffect(() => {
    const lowerBin = ordered[Math.min(lower, upper)]?.binId;
    const upperBin = ordered[Math.max(lower, upper)]?.binId;
    if (lowerBin === undefined || upperBin === undefined) return;
    publishDlmmRange({
      pool: data.pool.toLowerCase(),
      lower: lowerBin,
      upper: upperBin,
      source: "form",
    });
  }, [data.pool, lower, ordered, upper]);
  useEffect(() => {
    const pool = data.pool.toLowerCase();
    function receive(event: Event) {
      if (!isDlmmRangeEvent(event) || event.detail.source !== "chart" || event.detail.pool !== pool) return;
      const nextLower = ordered.findIndex((bin) => bin.binId === event.detail.lower);
      const nextUpper = ordered.findIndex((bin) => bin.binId === event.detail.upper);
      if (nextLower >= 0) setLower(nextLower);
      if (nextUpper >= 0) setUpper(nextUpper);
    }
    window.addEventListener(dlmmRangeEvent, receive);
    return () => window.removeEventListener(dlmmRangeEvent, receive);
  }, [data.pool, ordered]);

  const start = Math.min(lower, upper);
  const end = Math.max(lower, upper);
  const visible = ordered.slice(start, end + 1).slice(0, 24);
  const maxLiquidity = Math.max(1, ...visible.map((bin) => liquidityMagnitude(bin.totalShares)));

  function selectShape(next: Shape) {
    setShape(next);
    if (next === "spot") {
      setLower(activeIndex);
      setUpper(activeIndex);
      onSelectBin(ordered[activeIndex]?.binId ?? data.activeBin);
      return;
    }
    setLower(Math.max(0, activeIndex - 4));
    setUpper(Math.min(ordered.length - 1, activeIndex + 4));
  }

  return (
    <section className="mt-4 border border-line p-3" aria-label="DLMM liquidity shape preview">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Liquidity shape">
        {(["spot", "curve", "bid-ask"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={shape === value}
            onClick={() => selectShape(value)}
            className={`border px-3 py-1.5 font-mono text-[10px] uppercase ${shape === value ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-fg"}`}
          >
            {value === "bid-ask" ? "Bid-Ask" : value}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase text-faint">
          Lower bin
          <select
            className="mt-1 h-9 w-full border border-line bg-bg px-2 font-mono text-xs"
            value={lower}
            disabled={disabled || shape === "spot"}
            onChange={(event) => setLower(Number(event.target.value))}
          >
            {ordered.map((bin, index) => <option key={bin.binId} value={index}>{bin.binId}</option>)}
          </select>
          <span className="mt-1 block truncate font-mono normal-case text-muted">
            Min price {formatBinPrice(ordered[lower]?.priceX18)}
          </span>
        </label>
        <label className="text-[10px] uppercase text-faint">
          Upper bin
          <select
            className="mt-1 h-9 w-full border border-line bg-bg px-2 font-mono text-xs"
            value={upper}
            disabled={disabled || shape === "spot"}
            onChange={(event) => setUpper(Number(event.target.value))}
          >
            {ordered.map((bin, index) => <option key={bin.binId} value={index}>{bin.binId}</option>)}
          </select>
          <span className="mt-1 block truncate font-mono normal-case text-muted">
            Max price {formatBinPrice(ordered[upper]?.priceX18)}
          </span>
        </label>
      </div>
      <div className="mt-3 flex h-24 items-end gap-1 border-b border-line px-1" aria-label="Real indexed bin liquidity preview">
        {visible.map((bin, index) => {
          const realHeight = 10 + (liquidityMagnitude(bin.totalShares) / maxLiquidity) * 70;
          const weight = shapeWeight(shape, index, visible.length);
          return (
            <button
              key={bin.binId}
              type="button"
              title={`Bin ${bin.binId} · shares ${bin.totalShares}`}
              aria-label={`Select bin ${bin.binId}`}
              disabled={disabled || shape !== "spot"}
              onClick={() => onSelectBin(bin.binId)}
              className={`relative min-w-1 flex-1 border-x ${bin.binId === data.activeBin ? "border-lime" : "border-line"}`}
              style={{ height: `${realHeight}%`, opacity: 0.35 + weight * 0.65 }}
            >
              {bin.binId === data.activeBin ? <span className="absolute inset-x-0 -top-4 font-mono text-[8px] text-lime">A</span> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-5 text-muted">
        Bars use finalized indexed bin shares. {shape === "spot"
          ? "Spot submits one selected bin through the current DLMM v1 route."
          : "This multi-bin shape is preview-only on DLMM v1. Select Spot before submitting liquidity."}
      </p>
    </section>
  );
}

function liquidityMagnitude(raw: string) {
  if (!/^\d+$/u.test(raw) || raw === "0") return 0;
  return Math.log10(Number(raw.slice(0, 15))) + Math.max(0, raw.length - 15);
}

function shapeWeight(shape: Shape, index: number, length: number) {
  if (shape === "spot" || length <= 1) return 1;
  const centerDistance = Math.abs(index - (length - 1) / 2) / Math.max(1, (length - 1) / 2);
  return shape === "curve" ? 1 - centerDistance * 0.75 : 0.25 + centerDistance * 0.75;
}

function formatBinPrice(raw: string | undefined) {
  if (!raw || !/^\d+$/u.test(raw)) return "—";
  const value = formatUnits(BigInt(raw), 18);
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.slice(0, 8).replace(/0+$/u, "") || "0"}`;
}
