"use client";
import { motion } from "motion/react";
import { useId } from "react";
import { cx } from "@/lib/format";

export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; size?: "sm" | "md" }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-sm border border-line bg-bg p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx("relative rounded-[4px] px-3 font-semibold wide transition-colors duration-150 cursor-pointer", size === "sm" ? "h-8 text-xs" : "h-9 text-[13px]", on ? "text-lime-ink" : "text-muted hover:text-fg")}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[4px] bg-lime" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
