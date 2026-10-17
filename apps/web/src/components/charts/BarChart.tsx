"use client";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

export function BarChart({ data, height = 200, format, label, formatT = (t) => String(t) }: { data: { t: string; v: number }[]; height?: number; format: (v: number) => string; label: string; formatT?: (t: string) => string }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.v));
  return (
    <figure className="relative">
      <div role="img" aria-label={`${label}. Peak ${format(max)}. Latest ${format(data[data.length - 1].v)}.`} className="flex items-end gap-[2px]" style={{ height }} onPointerLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.t} className="relative flex h-full flex-1 items-end" onPointerEnter={() => setHover(i)}>
            <motion.div
              className={`w-full origin-bottom rounded-t-[1px] transition-colors duration-150 ${hover === i ? "bg-lime" : hover === null && i === data.length - 1 ? "bg-lime" : "bg-[#2e3550]"}`}
              style={{ height: `${Math.max((d.v / max) * 100, 1.5)}%` }}
              initial={reduce ? false : { scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.008, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[12px] text-faint">
        <span>{formatT(data[0].t)}</span><span>{formatT(data[data.length - 1].t)}</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-sm border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-[12px] whitespace-nowrap" style={{ left: `clamp(60px, ${((hover + 0.5) / data.length) * 100}%, calc(100% - 60px))` }}>
          <span className="text-faint">{formatT(data[hover].t)}</span> <span className="text-fg">{format(data[hover].v)}</span>
        </div>
      )}
    </figure>
  );
}
