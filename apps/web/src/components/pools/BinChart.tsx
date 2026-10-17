"use client";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { Bin } from "@/data/pools";
import { fmtPrice, fmtUsdCompact } from "@/lib/format";

export type Shape = "Spot" | "Curve" | "Bid-Ask";

export function shapeWeight(shape: Shape, o: number, lo: number, hi: number) {
  if (o < lo || o > hi) return 0;
  const span = Math.max(1, hi - lo);
  const t = (o - lo) / span; // 0..1
  if (shape === "Spot") return 1;
  if (shape === "Curve") return Math.exp(-((t - 0.5) ** 2) / 0.06);
  return 0.25 + Math.abs(t - 0.5) * 1.5;
}

export function BinChart({ bins, lo, hi, shape, quote, base, height = 240 }: { bins: Bin[]; lo?: number; hi?: number; shape?: Shape; quote: string; base: string; height?: number }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bins.map((b) => b.base + b.quote));
  const hb = hover !== null ? bins[hover] : null;
  const hasRange = lo !== undefined && hi !== undefined && shape;

  return (
    <figure className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Liquidity by bin. Active bin price ${fmtPrice(bins.find((b) => b.offset === 0)!.price)} ${quote}.${hasRange ? ` Your range covers bins ${lo} to ${hi} around the active bin.` : ""}`}>
        {bins.map((b, i) => {
          const h = (b.base + b.quote) / max;
          const inRange = hasRange && b.offset >= lo && b.offset <= hi;
          const w = hasRange ? shapeWeight(shape, b.offset, lo, hi) : 0;
          return (
            <div key={b.id} className="relative flex h-full flex-1 items-end" onPointerEnter={() => setHover(i)}>
              <motion.div
                className={`w-full origin-bottom rounded-t-[1px] transition-colors duration-200 ${b.offset === 0 ? "bg-lime" : b.offset < 0 ? "bg-[#3d4566]" : "bg-[#c9cfe6]"} ${hasRange && !inRange ? "opacity-35" : ""}`}
                style={{ height: `${Math.max(h * 100, 2)}%` }}
                initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
                transition={{ duration: 0.7, delay: Math.abs(b.offset) * 0.012, ease: [0.16, 1, 0.3, 1] }}
              />
              {inRange && (
                <motion.div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-t-[1px] border-t-2 border-lime bg-lime/25"
                  animate={{ height: `${Math.min(100, 18 + w * 62)}%` }} transition={{ type: "spring", stiffness: 260, damping: 26 }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[12px] text-faint">
        <span>{fmtPrice(bins[0].price)}</span>
        <span className="text-lime">active {fmtPrice(bins.find((b) => b.offset === 0)!.price)}</span>
        <span>{fmtPrice(bins[bins.length - 1].price)}</span>
      </div>
      {hb && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-sm border border-line-strong bg-raised px-3 py-2 font-mono text-[12px] whitespace-nowrap" style={{ left: `clamp(80px, ${((hover! + 0.5) / bins.length) * 100}%, calc(100% - 80px))` }}>
          <p className="text-faint">bin {hb.offset > 0 ? "+" : ""}{hb.offset} · {fmtPrice(hb.price)}</p>
          <p className="text-fg">{hb.quote > 0 && `${fmtUsdCompact(hb.quote)} ${quote}`}{hb.quote > 0 && hb.base > 0 && " + "}{hb.base > 0 && `${fmtUsdCompact(hb.base)} ${base}`}</p>
        </div>
      )}
    </figure>
  );
}
