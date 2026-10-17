"use client";
import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

type P = { t: string | number; v: number };

export function AreaChart({ data, height = 220, format, label, formatT = (t) => String(t), showAxis = true }: { data: P[]; height?: number; format: (v: number) => string; label: string; formatT?: (t: string | number) => string; showAxis?: boolean }) {
  const W = 800;
  const H = height;
  const pad = { t: 12, r: 8, b: showAxis ? 26 : 6, l: 8 };
  const id = useId();
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const { pts, line, area, min, max } = useMemo(() => {
    const vs = data.map((d) => d.v);
    const min = Math.min(...vs), max = Math.max(...vs);
    const span = max - min || 1;
    const pts = data.map((d, i) => ({
      x: pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r),
      y: pad.t + (1 - (d.v - min) / span) * (H - pad.t - pad.b) * 0.92 + (H - pad.t - pad.b) * 0.04,
    }));
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
    const area = `${line}L${pts[pts.length - 1].x},${H - pad.b}L${pts[0].x},${H - pad.b}Z`;
    return { pts, line, area, min, max };
  }, [data, H, pad.b, pad.l, pad.r, pad.t]);

  const onMove = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((x - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(data.length - 1, (h ?? data.length - 2) + 1));
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? data.length) - 1));
    if (e.key === "Escape") setHover(null);
  };

  const h = hover !== null ? pts[hover] : null;
  const ticks = showAxis ? [0, Math.floor(data.length / 2), data.length - 1] : [];

  return (
    <figure className="relative">
      <svg
        ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y" role="img" tabIndex={0}
        aria-label={`${label}. Range ${format(min)} to ${format(max)}. Latest ${format(data[data.length - 1].v)}. Use arrow keys to read values.`}
        onPointerMove={(e) => onMove(e.clientX)} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#dfe3ee" stopOpacity="0.22" />
            <stop offset="1" stopColor="#dfe3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="#1d1e2e" strokeDasharray="2 4" />
        ))}
        <motion.path d={area} fill={`url(#g${id})`} initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.4 }} />
        <motion.path d={line} fill="none" stroke="#dfe3ee" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
        {ticks.map((i) => (
          <text key={i} x={pts[i].x} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} fontSize={12} fill="#747a96" className="font-mono">{formatT(data[i].t)}</text>
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={h.x} x2={h.x} y1={pad.t} y2={H - pad.b} stroke="#a3a8c0" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={h.x} cy={h.y} r={5} fill="#dfe3ee" stroke="#0c0c15" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-sm border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-[12px] whitespace-nowrap shadow-[0_8px_20px_-8px_rgba(0,0,0,0.8)]" style={{ left: `clamp(60px, ${(h.x / W) * 100}%, calc(100% - 60px))` }}>
          <span className="text-faint">{formatT(data[hover].t)}</span> <span className="text-fg">{format(data[hover].v)}</span>
        </div>
      )}
    </figure>
  );
}
