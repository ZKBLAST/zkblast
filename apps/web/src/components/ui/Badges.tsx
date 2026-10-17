import { cx } from "@/lib/format";
import { tokenBySymbol } from "@/data/tokens";
import { ArrowDown, ArrowUp } from "lucide-react";

// The only place the app talks about privacy on an action. Public actions are never marked private.
export function LaneBadge({ lane, className, stage = true }: { lane: "public" | "shielded"; className?: string; stage?: boolean }) {
  return lane === "public" ? (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-xs border border-line-strong px-2 font-mono text-[11px] uppercase tracking-wide text-muted", className)}>
      <span className="size-1.5 rounded-full bg-muted" aria-hidden />
      Public AMM
    </span>
  ) : (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-xs border border-lime/60 px-2 font-mono text-[11px] uppercase tracking-wide text-lime", className)}>
      <span className="size-1.5 rounded-full bg-lime" aria-hidden />
      {stage ? "Shielded (Testnet)" : "Shielded vault"}
    </span>
  );
}

export function SimBadge({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center rounded-xs bg-raised px-2 font-mono text-[11px] uppercase tracking-wide text-faint", className)}>
      Simulated data
    </span>
  );
}

export function TypeTag({ type }: { type: "DLMM" | "DAMM" }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded-xs px-1.5 font-mono text-[10.5px] font-semibold tracking-wide", type === "DLMM" ? "bg-fg text-bg" : "border border-line-strong text-muted")}>
      {type}
    </span>
  );
}

// Generated token mark (not an official logo).
export function TokenMark({ symbol, size = 28, className }: { symbol: string; size?: number; className?: string }) {
  const t = tokenBySymbol(symbol);
  const hue = t?.hue ?? 90;
  return (
    <span
      aria-hidden
      className={cx("inline-grid shrink-0 place-items-center rounded-full font-mono font-bold", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        letterSpacing: "-0.04em",
        background: `oklch(0.32 0.06 ${hue})`,
        color: `oklch(0.92 0.06 ${hue})`,
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
      }}
    >
      {size >= 22 ? t?.glyph ?? symbol.slice(0, 2) : (t?.glyph ?? symbol).slice(-1)}
    </span>
  );
}

export function PairMark({ base, quote, size = 28 }: { base: string; quote: string; size?: number }) {
  return (
    <span className="inline-flex items-center">
      <TokenMark symbol={base} size={size} />
      <TokenMark symbol={quote} size={size} className="-ml-2 ring-2 ring-bg" />
    </span>
  );
}

export function Delta({ v, className }: { v: number; className?: string }) {
  const up = v >= 0;
  return (
    <span className={cx("num text-[13px]", up ? "text-up" : "text-danger", className)}>
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      <span className="sr-only">{up ? "up" : "down"}</span> {Math.abs(v).toFixed(2)}%
    </span>
  );
}
