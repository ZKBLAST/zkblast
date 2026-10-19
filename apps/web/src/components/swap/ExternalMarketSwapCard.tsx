"use client";

import { useState } from "react";

import { ExternalMarketTrade } from "@/components/markets/ExternalMarketTrade";
import { MarketPairLogo } from "@/components/markets/MarketPairLogo";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge } from "@/components/ui/Badges";
import { useExternalMarkets } from "@/lib/use-external-markets";

export function ExternalMarketSwapCard() {
  const { config } = useApp();
  const { items, loading, error, refresh } = useExternalMarkets();
  const markets = items.filter((market) => market.canTrade);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const selectedMarket =
    markets.find((market) => market.id === selectedMarketId) ??
    markets[0] ??
    null;

  return (
    <section className="panel ticks" aria-label="Validated market swap">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <LaneBadge lane="public" />
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-lime">
          Validated routes only
        </span>
      </div>
      <div className="p-5">
        <RealDataState
          loading={loading}
          error={error}
          empty={!markets.length}
          onRetry={refresh}
        />
        {selectedMarket ? (
          <label className="block">
            <span className="label">
              {config
                ? `${config.environment[0]?.toUpperCase()}${config.environment.slice(1)}`
                : "Network"}{" "}
              market
            </span>
            <span className="mt-2 flex items-center gap-3 border border-line bg-bg p-3">
              <MarketPairLogo market={selectedMarket} />
              <select
                value={selectedMarket.id}
                onChange={(event) => setSelectedMarketId(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-bg font-mono text-sm outline-none"
              >
                {markets.map((market) => {
                  const route = market.pairCandidates.find(
                    (candidate) => candidate.routeStatus === "validated",
                  );
                  return (
                    <option key={market.id} value={market.id}>
                      {market.symbol} / {route?.quoteSymbol ?? "Unavailable"}
                    </option>
                  );
                })}
              </select>
            </span>
          </label>
        ) : null}
      </div>
      <ExternalMarketTrade market={selectedMarket} />
      <p className="border-t border-line px-5 py-4 text-[12px] text-faint">
        Quotes and calldata are generated only for a database-validated on-chain
        route. Internal regression assets are never offered here.
      </p>
    </section>
  );
}
