"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { TokenMark } from "@/components/ui/Badges";
import { activity } from "@/data/analytics";
import { pools, priceHistory } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";
import { cx, fmtPrice } from "@/lib/format";

function ColHead({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg/80">{left}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{right}</span>
    </div>
  );
}

function ColFoot({ text }: { text: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
      <span className="relative grid size-2 place-items-center" aria-hidden>
        <span className="absolute size-2 bg-lime/40 motion-safe:animate-ping" />
        <span className="size-1.5 bg-lime" />
      </span>
      {text}
    </div>
  );
}

// Left rail: the public pools as a price registry, each with its recent path.
export function PoolRail() {
  const rows = useMemo(() => pools.slice(0, 8).map((p) => ({ p, hist: priceHistory(p, 40).map((x) => x.v), ch: tokenBySymbol(p.base).change24h })), []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColHead left="Pools" right={`${pools.length} feeds · live`} />
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <ul className="panel-inset space-y-1.5 p-1.5">
          {rows.map(({ p, hist, ch }, i) => (
            <motion.li key={p.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.06, duration: 0.5 }}
              className="panel flex items-center gap-2.5 px-2.5 py-2">
              <TokenMark symbol={p.base} size={22} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-fg">{p.base}/{p.quote}</p>
                <p className="font-mono text-[9.5px] uppercase text-faint">{p.type}</p>
              </div>
              <Sparkline data={hist} width={54} height={20} up={ch >= 0} />
              <div className="w-[68px] text-right">
                <p className="num truncate text-[11px] text-fg">{fmtPrice(p.price)}</p>
                <p className={cx("num text-[9.5px]", ch >= 0 ? "text-up" : "text-danger")}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</p>
              </div>
            </motion.li>
          ))}
        </ul>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a0a12] to-transparent" />
      </div>
      <ColFoot text="Live price registry" />
    </div>
  );
}

type Ev = { id: number; time: string; type: string; text: string; state: string; lane: "public" | "shielded" };

const clock = (d: Date) => d.toTimeString().slice(0, 8);

// Right rail: an event terminal. Commitment inserts from the hero tree and public pool activity share one stream.
export function EventStream({ commits }: { commits: { leaf: number; root: string }[] }) {
  const reduce = useReducedMotion();
  const seq = useRef(0);
  const [events, setEvents] = useState<Ev[]>(() =>
    activity.slice(0, 5).map((a, i) => ({ id: -i - 1, time: "--:--:--", type: a.kind.startsWith("Shielded") ? "VAULT" : a.kind.toUpperCase(), text: a.summary, state: "DONE", lane: a.lane })),
  );

  useEffect(() => {
    const c = commits[0];
    if (!c) return;
    setEvents((e) => [{ id: ++seq.current, time: clock(new Date()), type: "COMMIT", text: `leaf #${c.leaf.toLocaleString("en-US")} · root ${c.root}`, state: "INSERTED", lane: "shielded" as const }, ...e].slice(0, 7));
  }, [commits]);

  useEffect(() => {
    if (reduce) return;
    let k = 0;
    const id = setInterval(() => {
      const a = activity[k++ % activity.length];
      if (a.lane === "shielded") return;
      setEvents((e) => [{ id: ++seq.current, time: clock(new Date()), type: a.kind.toUpperCase(), text: a.summary, state: "PUBLIC", lane: "public" as const }, ...e].slice(0, 7));
    }, 3100);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColHead left="Event stream" right="live" />
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div className="panel-inset relative h-full overflow-hidden">
          <div className="grid grid-cols-[58px_1fr_auto] border-b border-line px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            <span>Time</span><span>Event</span><span>State</span>
          </div>
          <ul className="space-y-1.5 p-1.5" aria-live="off">
            <AnimatePresence initial={false}>
              {events.map((e, i) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, y: -10, backgroundColor: "rgba(223,227,238,0.08)" }} animate={{ opacity: 1 - i * 0.1, y: 0, backgroundColor: "rgba(223,227,238,0)" }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className={cx("grid grid-cols-[58px_1fr_auto] items-start gap-x-2 border border-line border-l-2 px-2.5 py-2 font-mono", e.lane === "shielded" ? "border-l-lime" : "border-l-steel/50")}>
                  <span className="text-[9.5px] text-faint">{e.time}</span>
                  <span className="min-w-0">
                    <span className="text-[10px] font-semibold text-fg">{e.type}</span>
                    <span className="mt-0.5 block truncate text-[9.5px] text-muted">{e.text}</span>
                  </span>
                  <span className={cx("text-[9px] uppercase", e.lane === "shielded" ? "text-lime" : "text-faint")}>{e.state}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-steel/[0.05] to-transparent motion-safe:animate-[scanline_4.5s_linear_infinite]" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-12 items-end gap-[3px] border-t border-line bg-[#08080f] px-2 pb-1.5">
            {Array.from({ length: 22 }, (_, i) => (
              <motion.span key={i} className="flex-1 origin-bottom bg-steel/25" style={{ height: "100%" }}
                initial={{ scaleY: 0.2 }} animate={reduce ? { scaleY: 0.4 } : { scaleY: [0.2, 0.25 + ((i * 37) % 70) / 100, 0.2] }}
                transition={{ duration: 2.2 + (i % 5) * 0.3, repeat: Infinity, delay: i * 0.07 }} />
            ))}
          </div>
        </div>
      </div>
      <ColFoot text="Commitment stream" />
    </div>
  );
}
