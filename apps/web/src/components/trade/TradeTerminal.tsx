"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PositionsView } from "@/app/positions/PositionsView";
import { MarketPriceChart } from "@/components/markets/MarketPriceChart";
import { useApp } from "@/components/shell/AppProvider";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import {
  tradeInstruments,
  tradeMode,
  tradePanel,
} from "@/lib/trade-instruments";
import { TradeActions } from "./TradeActions";
import { TerminalTabs } from "./TerminalTabs";
import { TradeDataProvider } from "./TradeDataProvider";
import { InstrumentLogo, MarketBrowser } from "./MarketBrowser";
import { MarketActivity, TradeHistory } from "./TradeHistory";

export function TradeTerminal() {
  return (
    <TradeDataProvider>
      <Terminal />
    </TradeDataProvider>
  );
}

function Terminal() {
  const { config } = useApp();
  const protocol = useProtocolData();
  const markets = useExternalMarkets();
  const search = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const instruments = tradeInstruments(
    protocol.pools,
    markets.items,
    config?.chainId,
  );
  const selectedId = search.get("pool") ?? search.get("market");
  const selected =
    instruments.find((item) => item.id === selectedId?.toLowerCase()) ??
    instruments[0];
  const mode = tradeMode(search.get("mode"));
  const panel = tradePanel(search.get("panel"));

  function update(key: string, value: string) {
    if (busy) return;
    const params = new URLSearchParams(search.toString());
    params.set(key, value);
    if (key === "pool") params.delete("market");
    router.replace(`/trade?${params.toString()}`, { scroll: false });
  }
  async function refresh() {
    await Promise.all([protocol.refresh(), markets.refresh()]);
  }

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-8 pt-[calc(var(--header-h)+1rem)] sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-mono text-lg uppercase tracking-[0.12em]">Trade</h1>
        <p className="font-mono text-[10px] uppercase text-muted">
          {config
            ? `${config.environment} · ${config.chainName} · ${config.chainId}`
            : "Loading network…"}
        </p>
      </div>
      <div className="panel ticks grid min-w-0 xl:h-[max(42rem,calc(100dvh-var(--header-h)-6rem))] xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        <MarketBrowser
          items={instruments}
          selected={selected?.id}
          loading={protocol.loading || markets.loading}
          error={protocol.error ?? markets.error}
          disabled={busy}
          onSelect={(id) => update("pool", id)}
          onRetry={() => void refresh()}
        />
        <section
          className="flex min-h-0 min-w-0 flex-col bg-[#0a0a12]/60 xl:overflow-y-auto"
          aria-label="Selected market chart"
        >
          <div className="flex min-h-20 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            {selected && <InstrumentLogo instrument={selected} />}
            <div className="min-w-0 flex-1">
              <h2 className="font-mono text-lg">
                {selected
                  ? `${selected.base}/${selected.quote}`
                  : "Select a market"}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {selected?.pool
                  ? `${selected.pool.model.toUpperCase()}${selected.pool.feeBps === null ? " · validated route" : ` · ${selected.pool.feeBps / 100}% pool fee`}`
                  : "Chart browsing · no validated execution pool"}
              </p>
            </div>
          </div>
          <MarketPriceChart
            key={`${selected?.market?.id ?? "no-market"}:${revision}`}
            marketId={selected?.market?.id ?? null}
            poolAddress={selected?.pool?.address ?? null}
            pairLabel={selected ? `${selected.base}/${selected.quote}` : undefined}
            inverted={Boolean(selected?.pool && selected.base !== selected.pool.token0Symbol)}
          />
          <p className="px-4 pb-4 text-xs leading-relaxed text-faint">
            Chart sources are shown separately. Oracle/reference prices are not
            executable pool quotes. Request a fresh quote in the action panel
            before signing.
          </p>
          <div className="border-t border-line px-4 py-3 text-xs text-muted">
            {protocol.metrics?.ready
              ? "Indexer up to date"
              : "Historical indexing in progress"}
            {selected?.pool && (
              <p className="mt-2 break-all font-mono text-[10px]">
                Pool {selected.pool.address}
              </p>
            )}
          </div>
        </section>
        <TradeActions
          selected={selected}
          mode={mode}
          busy={busy}
          onModeChange={(value) => update("mode", value)}
          onBusyChange={setBusy}
          onConfirmed={() => setRevision((value) => value + 1)}
        />
      </div>
      <section
        className="panel ticks mt-3 min-w-0"
        aria-label="Account and activity"
      >
        <TerminalTabs
          prefix="account"
          label="Account panels"
          value={panel}
          disabled={busy}
          onChange={(value) => update("panel", value)}
          items={[
            { value: "positions", label: "Positions" },
            { value: "history", label: "Trade history" },
            { value: "activity", label: "Network activity" },
          ]}
        />
        <div
          role="tabpanel"
          id="account-panel-positions"
          aria-labelledby="account-tab-positions"
          hidden={panel !== "positions"}
        >
          <PositionsView
            key={revision}
            compact
            onSelectPool={(address) => update("pool", address.toLowerCase())}
          />
        </div>
        <div
          role="tabpanel"
          id="account-panel-history"
          aria-labelledby="account-tab-history"
          hidden={panel !== "history"}
        >
          <TradeHistory />
        </div>
        <div
          role="tabpanel"
          id="account-panel-activity"
          aria-labelledby="account-tab-activity"
          hidden={panel !== "activity"}
        >
          <MarketActivity />
        </div>
      </section>
    </div>
  );
}
