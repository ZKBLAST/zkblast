"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { useApp } from "./AppProvider";
import { NetworkLogo } from "./NetworkLogo";

export function ChainSelector() {
  const { chains, config, selectChain, busy } = useApp();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const mainnetChains = useMemo(
    () => chains.filter((chain) => chain.environment === "mainnet"),
    [chains],
  );
  const activeChain = mainnetChains.find(
    (chain) => chain.chainId === config?.chainId,
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={root} className="relative hidden xl:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 cursor-pointer items-center gap-2 border border-line bg-raised px-2.5 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        {activeChain ? (
          <NetworkLogo family={activeChain.family} className="size-5" />
        ) : (
          <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(223,227,238,0.8)]" />
        )}
        <span className="max-w-36 truncate">{config?.chainName ?? "API sync"}</span>
        <ChevronDown
          className={cx("size-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Available ZKBLAST networks"
          className="absolute right-0 top-11 z-50 w-72 border border-line-strong bg-bg p-1.5 shadow-[0_16px_36px_#000b]"
        >
          <p className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Network
          </p>
          {mainnetChains.map((chain) => {
            const active = chain.chainId === config?.chainId;
            const available = chain.capabilities.launchpad && chain.configured;
            const content = (
              <>
                <NetworkLogo family={chain.family} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{chain.name}</span>
                  <span className="block text-[10px] uppercase text-faint">
                    Mainnet · {chain.chainId}
                  </span>
                </span>
                {active ? (
                  <Check className="size-3.5 text-lime" aria-label="Current network" />
                ) : (
                  <span className="text-[9px] uppercase tracking-wide text-faint">
                    {available ? "Open" : "Coming soon"}
                  </span>
                )}
              </>
            );
            return (
              <button
                key={chain.chainId}
                type="button"
                role="menuitem"
                aria-current={active ? "true" : undefined}
                disabled={!available || active || busy}
                onClick={() => {
                  void selectChain(chain.chainId)
                    .then(() => setOpen(false))
                    .catch(() => undefined);
                }}
                className={cx(
                  "flex min-h-12 w-full items-center gap-3 px-3 text-left font-mono transition-colors",
                  active ? "bg-lime/10 text-fg" : "text-muted hover:bg-lime/10 hover:text-fg",
                  (!available || busy) && "cursor-not-allowed opacity-55",
                )}
              >
                {content}
              </button>
            );
          })}
          {mainnetChains.length === 0 && (
            <p className="px-3 py-3 font-mono text-xs text-faint">
              Loading network catalog…
            </p>
          )}
          <p className="border-t border-line px-3 pb-2 pt-3 text-[11px] leading-4 text-faint">
            One interface, with isolated manifests, databases and indexer state per network.
          </p>
        </div>
      )}
    </div>
  );
}
