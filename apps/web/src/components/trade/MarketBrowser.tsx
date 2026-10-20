"use client";

import { Search, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import {
  MarketPairLogo,
  ProtocolPairLogo,
} from "@/components/markets/MarketPairLogo";
import { useExternalMarkets } from "@/lib/use-external-markets";
import type { TradeInstrument } from "@/lib/trade-instruments";

export function InstrumentLogo({
  instrument,
}: {
  instrument: TradeInstrument;
}) {
  const { items } = useExternalMarkets();
  return instrument.pool ? (
    <ProtocolPairLogo
      base={instrument.base}
      quote={instrument.quote}
      markets={items}
    />
  ) : instrument.market ? (
    <MarketPairLogo market={instrument.market} />
  ) : null;
}

export function MarketBrowser({
  items,
  selected,
  loading,
  error,
  disabled,
  onSelect,
  onRetry,
}: {
  items: readonly TradeInstrument[];
  selected: string | undefined;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const matches = items.filter((item) =>
    `${item.base} ${item.quote}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside
      className="min-w-0 border-b border-line bg-[#0a0a12]/80 xl:border-b-0 xl:border-r"
      aria-label="Markets"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex h-12 w-full items-center justify-between px-4 font-mono text-xs uppercase xl:hidden"
      >
        Markets · {items.length}
        {expanded ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </button>
      <div className={`${expanded ? "block" : "hidden"} xl:block`}>
        <div className="flex h-12 items-center justify-between border-b border-line px-4">
          <h2 className="label">Markets</h2>
          <span className="text-xs text-faint">{items.length}</span>
        </div>
        <label className="m-3 flex items-center gap-2 border border-line px-3">
          <Search className="size-4 text-faint" aria-hidden />
          <input
            aria-label="Search markets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search markets"
            className="h-10 w-full min-w-0 bg-transparent text-sm outline-none"
          />
        </label>
        <div className="max-h-[28rem] overflow-y-auto p-2 xl:max-h-[min(32rem,calc(100dvh-28rem))]">
          {loading && !items.length ? (
            <p className="p-3 text-sm text-muted" role="status">
              Loading markets…
            </p>
          ) : null}
          {error ? (
            <div className="p-3 text-xs text-warn">
              Market data could not be fully loaded.
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 cursor-pointer text-lime"
              >
                Retry
              </button>
            </div>
          ) : null}
          {!loading && !matches.length ? (
            <p className="p-3 text-sm text-muted">No matching markets.</p>
          ) : null}
          {matches.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected === item.id}
              onClick={() => {
                onSelect(item.id);
                setExpanded(false);
              }}
              className={`mb-1 flex w-full cursor-pointer items-center gap-2 border p-2.5 text-left disabled:cursor-wait ${selected === item.id ? "border-lime/50 bg-raised" : "border-transparent hover:border-line"}`}
            >
              <InstrumentLogo instrument={item} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">
                  {item.base}/{item.quote}
                </span>
                <span className="mt-1 block text-[10px] text-muted">
                  {item.pool
                    ? `${item.pool.model.toUpperCase()}${item.pool.feeBps === null ? " · validated route" : ` · ${item.pool.feeBps / 100}% fee`}`
                    : "View chart"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
