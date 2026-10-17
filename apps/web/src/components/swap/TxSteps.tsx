"use client";
import { motion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { cx } from "@/lib/format";

export type StepState = "idle" | "active" | "done" | "error";

export function TxSteps({ steps }: { steps: { label: string; detail?: string; state: StepState }[] }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-4 pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span className="absolute left-[13px] top-7 h-[calc(100%-24px)] w-px bg-line" aria-hidden>
              <motion.span className="block w-px bg-lime" initial={{ height: 0 }} animate={{ height: s.state === "done" ? "100%" : 0 }} transition={{ duration: 0.4 }} />
            </span>
          )}
          <span className={cx("relative grid size-7 shrink-0 place-items-center rounded-full border text-[12px]", s.state === "done" ? "border-lime bg-lime text-lime-ink" : s.state === "active" ? "border-lime text-lime" : s.state === "error" ? "border-danger text-danger" : "border-line-strong text-faint")}>
            {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "active" ? <Loader2 className="size-3.5 animate-spin" /> : s.state === "error" ? <X className="size-3.5" /> : <span className="num">{i + 1}</span>}
          </span>
          <div className="pt-0.5">
            <p className={cx("text-[15px] font-medium", s.state === "idle" ? "text-faint" : "text-fg")}>{s.label}</p>
            {s.detail && <p className="mt-0.5 text-[13px] text-faint">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
