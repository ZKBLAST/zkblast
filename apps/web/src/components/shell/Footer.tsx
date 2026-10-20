"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/components/shell/AppProvider";
import { nav } from "@/lib/nav";
import { Logo } from "./Logo";

export function Footer() {
  const { config } = useApp();
  const path = usePathname();
  if (path === "/trade")
    return (
      <footer className="mx-auto flex max-w-[1600px] flex-wrap justify-between gap-3 border-t border-line px-4 py-5 font-mono text-[10px] text-faint">
        <span>
          ZKBLAST · {config?.chainName ?? "Connecting to API"} ·{" "}
          {config?.environment ?? "Network pending"}
        </span>
        <span>
          Onchain transactions carry risk.{" "}
          <Link className="text-muted hover:text-fg" href="/docs">
            Read the user guide
          </Link>
        </span>
      </footer>
    );
  return (
    <footer className="mx-auto mt-32 max-w-[1392px] px-3 pb-3 sm:px-4">
      <div className="panel ticks p-2">
        <div className="panel-inset px-5 py-8 sm:px-8">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap justify-between gap-x-8 gap-y-3 font-mono text-[12.5px] uppercase tracking-[0.06em]">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className="text-fg/85 transition-colors hover:text-lime"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
              <li className="inline-flex items-center gap-2 text-fg/85">
                Status{" "}
                <span className="grid size-4 place-items-center border border-lime/50">
                  <span className="size-2 bg-lime" aria-hidden />
                </span>
                <span className="sr-only">operational</span>
              </li>
            </ul>
          </nav>

          <div className="grid gap-8 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
            <div>
              <Logo />
              <p className="mt-4 max-w-sm font-mono text-[13px] leading-relaxed text-muted">
                Zero-knowledge liquidity infrastructure. Operational values are
                read from validated {config?.environment ?? "network"} records.
              </p>
            </div>
            <div className="font-mono text-[12px] leading-relaxed text-faint md:text-right">
              <p className="uppercase tracking-[0.06em]">
                Built on Robinhood Chain
              </p>
              <p className="mt-2">
                Using smart contracts carries risk, including loss of funds.
                Nothing on this site is financial advice.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
            <span>ZKBLAST</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="text-faint/70">© 2026 ZKBLAST</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span>Robinhood Chain</span>
          </div>
        </div>
      </div>
      <div className="panel ticks mt-2 overflow-hidden p-2">
        <p
          aria-hidden
          className="display select-none whitespace-nowrap py-4 text-center text-[7.4vw] leading-[0.8] text-[#11111c] [text-shadow:0_1px_0_rgba(174,188,229,0.08)] xl:text-[104px]"
        >
          WITHOUT EXPOSURE
        </p>
      </div>
    </footer>
  );
}
