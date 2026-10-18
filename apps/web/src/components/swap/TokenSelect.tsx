/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- preserved reference UI; runtime actions remain gated by the live app provider. */
"use client";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { TokenMark } from "@/components/ui/Badges";
import { tokens } from "@/data/tokens";
import { useApp } from "@/components/shell/AppProvider";
import { fmtAmount, fmtUsd, cx } from "@/lib/format";

export function TokenSelect({ open, onClose, onPick, exclude }: { open: boolean; onClose: () => void; onPick: (s: string) => void; exclude?: string }) {
  const [q, setQ] = useState("");
  const { balances, address } = useApp();
  const list = useMemo(() => tokens.filter((t) => (t.symbol + t.name).toLowerCase().includes(q.trim().toLowerCase())), [q]);
  return (
    <Modal open={open} onClose={onClose} title="Select a token">
      <label className="relative block">
        <span className="sr-only">Search tokens</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or symbol…" autoComplete="off" spellCheck={false}
          className="h-12 w-full rounded-sm border border-line bg-bg pl-10 pr-3 text-[16px] outline-none transition-colors placeholder:text-faint focus:border-lime/70" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {["ETH", "USDC", "WBTC", "USDT"].map((s) => (
          <button key={s} onClick={() => onPick(s)} disabled={s === exclude} className="inline-flex h-9 items-center gap-2 rounded-sm border border-line px-2.5 text-[13px] font-semibold transition-colors hover:border-line-strong disabled:opacity-40 cursor-pointer">
            <TokenMark symbol={s} size={18} /> {s}
          </button>
        ))}
      </div>
      <ul className="-mx-2 mt-4 max-h-[46dvh] overflow-y-auto" data-lenis-prevent>
        {list.length === 0 && <li className="px-2 py-8 text-center text-sm text-muted">No token matches “{q}”. Check the symbol or paste a verified address once deployments are published.</li>}
        {list.map((t) => (
          <li key={t.symbol}>
            <button onClick={() => onPick(t.symbol)} disabled={t.symbol === exclude}
              className={cx("flex w-full items-center gap-3 rounded-sm px-2 py-2.5 text-left transition-colors hover:bg-raised disabled:opacity-40 cursor-pointer")}>
              <TokenMark symbol={t.symbol} size={32} />
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">{t.symbol}</span>
                <span className="block text-[13px] text-faint">{t.name}</span>
              </span>
              {address && (
                <span className="text-right">
                  <span className="num block text-[14px]">{fmtAmount(balances[t.symbol] ?? 0)}</span>
                  <span className="num block text-[12px] text-faint">{fmtUsd((balances[t.symbol] ?? 0) * t.priceUsd)}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
