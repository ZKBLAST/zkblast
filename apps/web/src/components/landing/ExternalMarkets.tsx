"use client";

import { CircleCheck, Clock3 } from "lucide-react";
import { useState } from "react";

import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { MarketPriceChart } from "@/components/markets/MarketPriceChart";
import {
  marketDisplayQuoteSymbol,
  MarketPairLogo,
} from "@/components/markets/MarketPairLogo";
import { ExternalMarketTrade } from "@/components/markets/ExternalMarketTrade";
import { Bay } from "@/components/ui/Frame";
import { cx } from "@/lib/format";
import { useExternalMarkets } from "@/lib/use-external-markets";

type MarketTab = "all" | "pons" | "us" | "china" | "other";
type Availability = "all" | "active" | "planned";

export function ExternalMarkets() {
  const { config } = useApp();
  const environment = config?.environment ?? "network";
  const chainId = config?.chainId ?? "—";
  const { items, loading, error, refresh } = useExternalMarkets();
  const [tab, setTab] = useState<MarketTab>("all");
  const [availability, setAvailability] = useState<Availability>("all");
  const rows = items.filter((item) => {
    const sourceMatches =
      tab === "all" ||
      (tab === "pons"
        ? item.source === "pons_graduated"
        : item.source === "robinhood_stock_token" &&
          item.marketRegion === (tab === "other" ? "unclassified" : tab));
    const availabilityMatches =
      availability === "all" ||
      (availability === "active" ? item.canTrade : !item.canTrade);
    return sourceMatches && availabilityMatches;
  });
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const activeMarketId = rows.some((market) => market.id === selectedMarketId)
    ? selectedMarketId
    : (rows[0]?.id ?? null);
  const activeMarket =
    rows.find((market) => market.id === activeMarketId) ?? null;

  return (
    <section
      className="mx-auto max-w-[1392px] px-3 pt-20 sm:px-4"
      aria-label="External markets"
    >
      <Bay index="02" title="Verified external markets" />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 className="display text-[clamp(2rem,4vw,3.2rem)]">
            Beyond protocol pools.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            All verified reference markets remain discoverable. A market is
            active on {environment} only when its chain-{chainId} token, pool,
            liquidity, and route have passed independent validation.
          </p>
        </div>
        <div
          className="panel-inset flex max-w-full flex-wrap p-1"
          role="tablist"
          aria-label="External market source"
        >
          {(
            [
              ["all", "All markets"],
              ["pons", "pons > $1m"],
              ["us", "US stocks"],
              ["china", "China stocks"],
              ["other", "Other / pending"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cx(
                "h-9 cursor-pointer px-4 font-mono text-[10px] uppercase tracking-[0.1em]",
                tab === value
                  ? "bg-lime text-lime-ink"
                  : "text-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div
          className="panel-inset flex max-w-full flex-wrap p-1"
          role="tablist"
          aria-label={`${environment} availability`}
        >
          {(
            [
              ["all", "All"],
              ["active", `Active on ${environment}`],
              ["planned", "Reference only"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={availability === value}
              onClick={() => setAvailability(value)}
              className={cx(
                "h-9 cursor-pointer px-4 font-mono text-[10px] uppercase tracking-[0.1em]",
                availability === value
                  ? "bg-lime text-lime-ink"
                  : "text-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
          {items.filter((market) => market.canTrade).length} active ·{" "}
          {items.length} listed
        </p>
      </div>
      <div className="panel-inset mt-8">
        <RealDataState
          loading={loading}
          error={error}
          empty={!rows.length}
          onRetry={refresh}
        />
        {!!rows.length && (
          <ul>
            {rows.map((market) => (
              <li
                key={market.id}
                aria-current={activeMarketId === market.id ? "true" : undefined}
                onClick={() => setSelectedMarketId(market.id)}
                className={cx(
                  "grid cursor-pointer gap-3 border-b border-line p-4 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:items-center",
                  activeMarketId === market.id && "bg-white/[0.025]",
                )}
              >
                <div className="flex items-center gap-3">
                  <MarketPairLogo market={market} />
                  <span>
                    <span className="block font-mono text-sm text-fg">
                      {market.symbol}/{marketDisplayQuoteSymbol(market)}
                    </span>
                    <span className="block text-xs text-faint">
                      {market.name}
                    </span>
                  </span>
                </div>
                <MarketDatum
                  label="Bid / ask"
                  value={
                    market.bid && market.ask
                      ? `${market.bid} / ${market.ask}`
                      : "On-chain market"
                  }
                />
                <MarketDatum
                  label={`${environment} pairs`}
                  value={
                    market.pairCandidates.length
                      ? market.pairCandidates
                          .map(
                            (pair) =>
                              `${pair.quoteSymbol} (${pair.routeStatus})`,
                          )
                          .join(" · ")
                      : "No validated pair"
                  }
                />
                <MarketDatum
                  label="Execution"
                  value={
                    market.canTrade
                      ? `Active on ${environment}`
                      : "Reference only"
                  }
                />
                <MarketStatus active={market.canTrade} />
              </li>
            ))}
          </ul>
        )}
        <MarketPriceChart marketId={activeMarketId} />
        <ExternalMarketTrade market={activeMarket} />
      </div>
    </section>
  );
}

function MarketStatus({ active }: { active: boolean }) {
  const Icon = active ? CircleCheck : Clock3;
  return (
    <span
      className={cx(
        "col-span-full flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] md:col-span-1 md:col-start-4 md:justify-self-end",
        active ? "text-lime" : "text-faint",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {active ? "Trading enabled" : "No validated route"}
    </span>
  );
}

function MarketDatum({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-xs">
      <span className="block text-[9px] uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <span className="mt-1 block truncate text-fg">{value}</span>
    </span>
  );
}
