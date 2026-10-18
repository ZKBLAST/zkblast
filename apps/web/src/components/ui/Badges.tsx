import { cx } from "@/lib/format";
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

export function TypeTag({ type }: { type: "DLMM" | "DAMM" }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded-xs px-1.5 font-mono text-[10.5px] font-semibold tracking-wide", type === "DLMM" ? "bg-fg text-bg" : "border border-line-strong text-muted")}>
      {type}
    </span>
  );
}

export function TokenMark({ symbol, size = 28, className }: { symbol: string; size?: number; className?: string }) {
  return (
    <svg aria-label={symbol} role="img" className={cx("shrink-0", className)} width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="#1f2435" stroke="#5f6b91" />
      <path d="M9 16h14M16 9v14" stroke="#dfe3ee" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
