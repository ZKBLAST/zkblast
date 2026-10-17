import type { ReactNode } from "react";
import { cx } from "@/lib/format";

// Faceplate module: framed panel with corner ticks and optional engraved labels on its edges.
export function Frame({ children, label, tag, className, inner, fins = false }: { children: ReactNode; label?: string; tag?: string; className?: string; inner?: string; fins?: boolean }) {
  return (
    <div className={cx("relative", className)}>
      <div className={cx("panel ticks h-full", inner)}>
        {label && <span className="label absolute left-4 top-3 z-10">{label}</span>}
        {tag && <span className="label absolute right-4 top-3 z-10">{tag}</span>}
        {children}
      </div>
      {fins && <div aria-hidden className="barcode mx-auto mt-1.5 w-24" />}
    </div>
  );
}

// Section heading strip: engraved index + title, the way a rack labels its bays.
export function Bay({ index, title, className }: { index: string; title: string; className?: string }) {
  return (
    <div className={cx("flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.1em] text-faint", className)}>
      <span><span className="text-lime">{index}</span> <span className="text-line-strong">/</span> <span className="text-fg/70">{title}</span></span>
      <span aria-hidden className="barcode h-[7px] flex-1 opacity-60" />
    </div>
  );
}
