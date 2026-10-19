"use client";

import { ExternalLink } from "lucide-react";

import { MarketPairLogo } from "@/components/markets/MarketPairLogo";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge } from "@/components/ui/Badges";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { useExternalMarkets } from "@/lib/use-external-markets";

export function PoolsView() {
  const { config } = useApp();
  const data = useExternalMarkets();
  const markets = data.items.filter((market) => market.canTrade);

  return (
    <>
      <PageHeader
        title="Pools"
        lead="Execution pools with a validated token identity, on-chain address, liquidity, and fresh testnet route."
        badges={<LaneBadge lane="public" />}
        aside={
          <dl className="grid grid-cols-2 gap-6">
            <Stat label="Validated pools" value={markets.length} />
            <Stat label="Network" value={config?.chainId ?? "—"} />
          </dl>
        }
      />
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <RealDataState
          loading={data.loading}
          error={data.error}
          empty={!markets.length}
          onRetry={data.refresh}
        />
        {markets.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {markets.map((market) => {
              const route = market.pairCandidates.find(
                (candidate) => candidate.routeStatus === "validated",
              );
              if (!route?.poolIdentifier) return null;
              return (
                <li
                  key={market.id}
                  className="grid gap-4 py-5 md:grid-cols-[1fr_auto_auto_auto] md:items-center"
                >
                  <span className="flex items-center gap-3">
                    <MarketPairLogo market={market} />
                    <span>
                      <strong>
                        {market.symbol}/{route.quoteSymbol}
                      </strong>
                      <span className="mt-1 block break-all font-mono text-xs text-faint">
                        {route.poolIdentifier}
                      </span>
                    </span>
                  </span>
                  <span className="font-mono text-xs uppercase text-muted">
                    {route.venue?.replace("zkblast_", "") ?? "Validated"}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    Liquidity raw {route.liquidityRaw ?? "Unavailable"}
                  </span>
                  {config ? (
                    <a
                      href={`${config.explorerUrl.replace(/\/$/u, "")}/address/${route.poolIdentifier}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-lime"
                    >
                      Contract <ExternalLink className="size-3" />
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
