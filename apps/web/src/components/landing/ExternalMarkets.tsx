"use client";

import { Database, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { RealDataState } from "@/components/protocol/real-data-state";
import { MarketPriceChart } from "@/components/markets/MarketPriceChart";
import { ExternalMarketTrade } from "@/components/markets/ExternalMarketTrade";
import { Bay } from "@/components/ui/Frame";
import { cx } from "@/lib/format";
import { useExternalMarkets } from "@/lib/use-external-markets";

type MarketTab = "pons" | "us" | "china";

export function ExternalMarkets() {
  const { items, loading, error, refresh } = useExternalMarkets();
  const [tab, setTab] = useState<MarketTab>("pons");
  const rows = items.filter((item) => {
    if (tab === "pons") return item.source === "pons_graduated";
    return item.source === "robinhood_stock_token" && item.marketRegion === tab;
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
            Graduated pons tokens are verified on-chain. US Stock Token prices
            are reference data from Robinhood. Neither source is routed through
            ZKBLAST unless an executable route is separately validated.
          </p>
        </div>
        <div
          className="panel-inset flex p-1"
          role="tablist"
          aria-label="External market source"
        >
          {(
            [
              ["pons", "pons > $1m"],
              ["us", "US stocks"],
              ["china", "China stocks"],
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
                  <MarketLogo market={market} />
                  <span>
                    <span className="block font-mono text-sm text-fg">
                      {market.symbol}/{market.quoteSymbol}
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
                  label="Pairs"
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
                  value={market.canTrade ? "Route verified" : "Read-only"}
                />
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

function MarketLogo({
  market,
}: {
  market: ReturnType<typeof useExternalMarkets>["items"][number];
}) {
  if (market.logoUrl) {
    return (
      // URLs are returned by the API only after manual approval.
      <img
        src={market.logoUrl}
        alt=""
        className="size-9 border border-line object-contain"
        referrerPolicy="no-referrer"
      />
    );
  }
  const Icon =
    market.source === "pons_graduated"
      ? ShieldCheck
      : market.logoStatus === "pending"
        ? ImageIcon
        : Database;
  return (
    <span className="grid size-9 place-items-center border border-line text-lime">
      <Icon className="size-4" aria-hidden="true" />
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
