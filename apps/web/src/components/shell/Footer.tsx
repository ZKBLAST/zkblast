"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/components/shell/AppProvider";
import { ContractAddressBadge } from "@/components/ui/ContractAddressBadge";
import { XIcon } from "@/components/ui/Icons";
import { nav } from "@/lib/nav";
import { Logo } from "./Logo";

export function Footer() {
  const { config } = useApp();
  const path = usePathname();
  if (path === "/trade")
    return (
      <footer className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-5 font-mono text-[10px] text-faint">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            ZKBLAST · {config?.chainName ?? "Connecting to API"} ·{" "}
            {config?.environment ?? "Network pending"}
          </span>
          <a
            href="https://x.com/zkblast9"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ZKBLAST on X"
            title="Follow @zkblast9 on X"
            className="inline-flex items-center text-muted hover:text-lime transition-colors"
          >
            <XIcon className="size-3" />
          </a>
          <ContractAddressBadge />
        </div>
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
              <li>
                <a
                  href="https://x.com/zkblast9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-fg/85 transition-colors hover:text-lime"
                  aria-label="Follow ZKBLAST on X"
                >
                  <XIcon className="size-3.5" />
                  <span>X</span>
                </a>
              </li>
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
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ContractAddressBadge />
                <a
                  href="https://x.com/zkblast9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-line bg-raised/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted transition-colors hover:border-lime/60 hover:text-fg"
                >
                  <XIcon className="size-3.5" />
                  <span>@zkblast9</span>
                </a>
              </div>
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

          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
            <span>ZKBLAST</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
            <a
              href="https://x.com/zkblast9"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-faint/80 hover:text-lime transition-colors"
              aria-label="ZKBLAST on X"
            >
              <XIcon className="size-3" />
              <span>@zkblast9</span>
            </a>
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
