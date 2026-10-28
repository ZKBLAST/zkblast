"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { cx } from "@/lib/format";

export function ContractAddressBadge({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const ca = (
    process.env.ZKBLAST_CA ??
    process.env.NEXT_PUBLIC_ZKBLAST_CA ??
    process.env.NEXT_PUBLIC_CA ??
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
    "0x3f9ff9f1d40369f99c281375bd19d6ecbebfecd7"
  ).trim();

  const handleCopy = useCallback(() => {
    if (!ca) return;
    void (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(ca);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = ca;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // copy failed silently
      }
    })();
  }, [ca]);

  if (!ca) return null;

  return (
    <div className={cx("flex items-center", className)}>
      <button
        type="button"
        onClick={() => {
          handleCopy();
        }}
        title="Click to copy Contract Address"
        aria-label={`Copy Contract Address ${ca}`}
        className="group relative inline-flex max-w-full items-center gap-2 border border-line-strong bg-[#0d0e19] px-3 py-1.5 font-mono text-[11px] text-muted transition-all duration-150 hover:border-lime/60 hover:text-fg hover:shadow-[0_0_12px_rgba(223,227,238,0.1)] active:scale-[0.99] cursor-pointer"
      >
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-lime shrink-0">
          <span className="size-1.5 bg-lime" aria-hidden />
          CA
        </span>
        <span className="h-3 w-px bg-line shrink-0" aria-hidden />
        <span className="break-all font-mono text-[11px] sm:text-[12px] tracking-tight text-fg/90 selection:bg-lime/30 selection:text-lime-ink">
          {ca}
        </span>
        <span className="ml-1 inline-flex items-center gap-1 shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint group-hover:text-lime">
          {copied ? (
            <>
              <Check className="size-3 text-lime" aria-hidden />
              <span className="text-lime">COPIED</span>
            </>
          ) : (
            <>
              <Copy className="size-3 transition-transform group-hover:scale-110" aria-hidden />
              <span>COPY</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}
