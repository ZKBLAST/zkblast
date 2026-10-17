"use client";
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

type Stage = { key: string; label: string; detail: string; ms: number };

// Runs simulated stages in order; long stages show their own progress.
export function ProofProgress({ stages, onDone, running }: { stages: readonly Stage[]; onDone: () => void; running: boolean }) {
  const [i, setI] = useState(0);
  const [p, setP] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  const total = stages.reduce((s, x) => s + x.ms, 0);
  const elapsed = stages.slice(0, i).reduce((s, x) => s + x.ms, 0) + (stages[i]?.ms ?? 0) * p;

  useEffect(() => {
    if (!running) return;
    if (i >= stages.length) { done.current(); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const f = Math.min(1, (t - start) / stages[i].ms);
      setP(f);
      if (f < 1) raf = requestAnimationFrame(tick);
      else { setI((x) => x + 1); setP(0); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, running, stages]);

  const pct = Math.round((elapsed / total) * 100);

  return (
    <div>
      <div className="flex items-end justify-between">
        <p className="num display text-[64px] leading-none text-lime" aria-hidden>{pct}<span className="text-[28px]">%</span></p>
        <p className="text-right font-mono text-[12px] text-faint">{i < stages.length ? stages[i].label : "Complete"}<br />runs in this browser tab</p>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Overall progress">
        <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-6 space-y-3">
        {stages.map((s, k) => {
          const state = k < i ? "done" : k === i ? "active" : "idle";
          return (
            <motion.li key={s.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.05 }} className="flex items-start gap-3">
              <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border", state === "done" ? "border-lime bg-lime text-lime-ink" : state === "active" ? "border-lime text-lime" : "border-line-strong text-faint")}>
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : state === "active" ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className={cx("text-[15px]", state === "idle" ? "text-faint" : "text-fg")}>{s.label}</p>
                  {state === "active" && s.ms > 2000 && <span className="num text-[12px] text-lime">{Math.round(p * 100)}%</span>}
                </div>
                <p className="text-[13px] text-faint">{s.detail}</p>
                {state === "active" && s.ms > 2000 && (
                  <div className="mt-2 h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-lime/70" style={{ width: `${p * 100}%` }} /></div>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{i < stages.length ? `${stages[i].label}, ${pct} percent` : "All steps complete"}</p>
    </div>
  );
}
