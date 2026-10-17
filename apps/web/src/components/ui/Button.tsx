"use client";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/format";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xs wide transition-[background-color,border-color,color,opacity,box-shadow] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer";
const variants: Record<Variant, string> = {
  primary: "bg-lime text-lime-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_0_1px_rgba(223,227,238,0.25),0_0_24px_-6px_rgba(223,227,238,0.45)] hover:bg-[#ffffff] active:bg-lime-dim",
  secondary: "border border-line-strong bg-[linear-gradient(180deg,#1a1b2a,#11111c)] text-fg shadow-[inset_0_1px_0_rgba(174,188,229,0.08)] hover:border-steel/40 hover:text-white",
  ghost: "text-muted hover:text-fg hover:bg-raised",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-[12px]",
  md: "h-11 px-5 text-[13px]",
  lg: "h-12 px-7 text-[14px]",
};

type Common = { variant?: Variant; size?: Size; loading?: boolean; children: ReactNode; className?: string };

export function Button({ variant = "primary", size = "md", loading, children, className, disabled, ...rest }: Common & ComponentProps<"button">) {
  return (
    <button className={cx(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", children, className, href, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={cx(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}
