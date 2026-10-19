"use client";

import { ExternalLink } from "lucide-react";

import { MarketPairLogo } from "@/components/markets/MarketPairLogo";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { useProtocolData } from "@/lib/use-protocol-data";

export function AnalyticsView() {
  const { config } = useApp();
  const markets = useExternalMarkets();
  const protocol = useProtocolData();
  const active = markets.items.filter((market) => market.canTrade);

  return (
    <>
      <PageHeader
        title="Analytics"
        lead={`Validated ${config?.environment ?? "network"} market coverage and indexer health. Invented TVL, APR, volume, and synthetic protocol values are not displayed.`}
        aside={
          <dl className="grid grid-cols-3 gap-6">
            <Stat label="Markets listed" value={markets.items.length} />
            <Stat label="Active routes" value={active.length} />
            <Stat label="Lag blocks" value={protocol.metrics?.lag ?? "—"} />
          </dl>
        }
      />
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <RealDataState
          loading={markets.loading}
          error={markets.error}
          empty={!active.length}
          onRetry={markets.refresh}
        />
        <h2 className="display mt-10 text-3xl">Validated execution routes</h2>
        {active.length ? (
          <ul className="mt-5 divide-y divide-line border-y border-line">
            {active.map((market) => {
              const route = market.pairCandidates.find(
                (candidate) => candidate.routeStatus === "validated",
              );
              return (
                <li
                  key={market.id}
                  className="grid gap-4 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <span className="flex items-center gap-3">
                    <MarketPairLogo market={market} />
                    <strong>
                      {market.symbol}/{route?.quoteSymbol}
                    </strong>
                  </span>
                  <span className="font-mono text-xs uppercase text-lime">
                    {route?.routeStatus}
                  </span>
                  {config && route?.poolIdentifier ? (
                    <a
                      href={`${config.explorerUrl.replace(/\/$/u, "")}/address/${route.poolIdentifier}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-lime"
                    >
                      Pool <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </>
  );
}
