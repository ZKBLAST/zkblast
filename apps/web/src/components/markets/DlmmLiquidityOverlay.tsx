"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { formatChartPrice } from "@/lib/market-chart-data";

export type PositionedLiquidityBin = Readonly<{
  binId: number;
  top: number;
  width: number;
  side: "base" | "quote" | "active";
  totalShares: string;
  price: number;
  owned: boolean;
}>;

export function DlmmLiquidityOverlay({
  bins,
  activeBin,
  lowerBin,
  upperBin,
  onDragStart,
}: {
  bins: readonly PositionedLiquidityBin[];
  activeBin: number;
  lowerBin: number;
  upperBin: number;
  onDragStart: (bound: "lower" | "upper", event: ReactPointerEvent) => void;
}) {
  if (!bins.length) return null;
  const lower = bins.find((bin) => bin.binId === lowerBin);
  const upper = bins.find((bin) => bin.binId === upperBin);
  const bandTop = Math.min(lower?.top ?? 0, upper?.top ?? 0);
  const bandBottom = Math.max(lower?.top ?? 0, upper?.top ?? 0);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-label="DLMM liquidity bins">
      <div
        className="absolute inset-x-0 border-y border-lime/30 bg-lime/5"
        style={{ top: bandTop, height: Math.max(2, bandBottom - bandTop) }}
      />
      {bins.map((bin) => (
        <div
          key={bin.binId}
          className={`absolute right-14 h-1 -translate-y-1/2 border-l ${bin.owned ? "ring-1 ring-white/90 ring-offset-1 ring-offset-bg" : ""} ${
            bin.side === "active"
              ? "border-lime bg-lime"
              : bin.side === "base"
                ? "border-cyan-300/80 bg-cyan-300/35"
                : "border-amber-300/80 bg-amber-300/35"
          }`}
          style={{ top: bin.top, width: `${bin.width}%` }}
          title={`Bin ${bin.binId} · ${formatChartPrice(bin.price)} · shares ${bin.totalShares}${bin.owned ? " · connected wallet position" : ""}`}
        />
      ))}
      {(["lower", "upper"] as const).map((bound) => {
        const bin = bound === "lower" ? lower : upper;
        if (!bin) return null;
        return (
          <button
            key={bound}
            type="button"
            className="pointer-events-auto absolute inset-x-0 z-20 h-5 -translate-y-1/2 touch-none cursor-ns-resize border-y border-white/35 bg-white/[0.03] text-left font-mono text-[8px] uppercase text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime"
            style={{ top: bin.top }}
            onPointerDown={(event) => onDragStart(bound, event)}
            aria-label={`Drag ${bound} liquidity range. Bin ${bin.binId}, price ${formatChartPrice(bin.price)}`}
          >
            <span className="ml-2 bg-bg/90 px-1.5 py-0.5">{bound} · {bin.binId}</span>
          </button>
        );
      })}
      <span className="absolute right-16 top-2 bg-bg/85 px-2 py-1 font-mono text-[8px] uppercase text-muted">
        DLMM bins · active {activeBin} · base / quote · outlined: wallet
      </span>
    </div>
  );
}
