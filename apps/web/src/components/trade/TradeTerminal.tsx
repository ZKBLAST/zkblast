"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PositionsView } from "@/app/positions/PositionsView";
import { MarketPriceChart } from "@/components/markets/MarketPriceChart";
import { PerpsPanel } from "@/components/perps/PerpsPanel";
import { PerpsAccountWorkspace } from "@/components/perps/PerpsAccountWorkspace";
import { useApp } from "@/components/shell/AppProvider";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import type { ChartPositionLine } from "@/lib/market-chart-data";
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
import { PoolStatsStrip } from "./PoolStatsStrip";
import { DlmmDepthBook } from "./DlmmDepthBook";
import { DammDepthView } from "./DammDepthView";

type PoolView = "chart" | "depth" | "book" | "split";

export function TradeTerminal() {
  return (
    <TradeDataProvider>
      <Terminal />
    </TradeDataProvider>
  );
}

function Terminal() {
  const { config, address, injectedAddress } = useApp();
  const wallet = injectedAddress ?? address;
  const protocol = useProtocolData(wallet);
  const markets = useExternalMarkets();
  const search = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [poolView, setPoolView] = useState<PoolView>("chart");
  const [perpsMarketId, setPerpsMarketId] = useState<string | null>(null);
  const [perpsPositions, setPerpsPositions] = useState<readonly Readonly<{
    positionId: string;
    marketId: string;
    isLong: boolean;
    marginRaw: string;
    entryPriceX18: string;
    status: "open" | "closed" | "liquidated";
  }>[]>([]);
  const [privatePositionLines, setPrivatePositionLines] = useState<readonly (ChartPositionLine & { marketId: string })[]>([]);
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

  useEffect(() => {
    if (selected?.pool?.model !== "dlmm" && (poolView === "book" || poolView === "split")) setPoolView("chart");
  }, [poolView, selected?.pool?.address, selected?.pool?.model]);

  useEffect(() => {
    const controller = new AbortController();
    if (mode !== "perps" || !wallet || !config?.perps) {
      setPerpsPositions([]);
      return () => controller.abort();
    }
    void apiRequest<{ items: typeof perpsPositions }>(
      webPublicConfig.apiUrl,
      `/v1/perps/positions?ownerAddress=${encodeURIComponent(wallet)}`,
      { signal: controller.signal },
    ).then((response) => setPerpsPositions(response.items)).catch(() => {
      if (!controller.signal.aborted) setPerpsPositions([]);
    });
    return () => controller.abort();
  }, [config?.perps, mode, revision, wallet]);
  const publicPositionLines = useMemo(() => perpsPositions
    .filter((position) => position.status === "open" && position.marketId === perpsMarketId)
    .map((position) => ({
      id: position.positionId,
      price: Number(position.entryPriceX18) / 1e18,
      color: position.isLong ? "#56d9ad" : "#f07b87",
      label: `${position.isLong ? "LONG" : "SHORT"} · ${(Number(position.marginRaw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDG`,
    })), [perpsMarketId, perpsPositions]);
  const positionLines = useMemo(
    () => [
      ...publicPositionLines,
      ...privatePositionLines.filter((line) => line.marketId === perpsMarketId),
    ],
    [perpsMarketId, privatePositionLines, publicPositionLines],
  );
  const selectedWalletLiquidityBins = useMemo(() => {
    const pool = selected?.pool?.address.toLowerCase();
    if (!pool || selected?.pool?.model !== "dlmm") return [];
    return [...new Set(protocol.positions.flatMap((position) => {
      if (
        position.status !== "open" ||
        position.model !== "dlmm" ||
        position.poolAddress.toLowerCase() !== pool ||
        position.lowerBound === null ||
        position.upperBound === null
      ) return [];
      const start = Math.max(-10_000, position.lowerBound);
      const end = Math.min(10_000, position.upperBound);
      return Array.from({ length: Math.min(61, end - start + 1) }, (_, index) => start + index);
    }))];
  }, [protocol.positions, selected?.pool?.address, selected?.pool?.model]);

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
  function handleConfirmed() {
    setRevision((value) => value + 1);
    void refresh();
  }

  if (mode === "perps" && !config) {
    return (
      <p className="px-4 pt-[calc(var(--header-h)+2rem)] text-sm text-muted">
        Loading network capabilities…
      </p>
    );
  }

  if (mode === "perps" && config && !config.perps) {
    return (
      <div className="mx-auto grid min-h-[calc(100dvh-var(--header-h))] max-w-[1600px] place-items-center px-4 pt-[var(--header-h)]">
        <section className="panel ticks max-w-xl p-8 text-center">
          <p className="label">Perpetuals unavailable</p>
          <h1 className="mt-3 text-2xl">Not enabled on {config.chainName}</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            This network does not publish a Perps deployment. Switch to a
            supported network or continue with its available pool and launch
            markets.
          </p>
        </section>
      </div>
    );
  }

  if (mode === "perps") {
    return (
      <div className="mx-auto max-w-[1600px] px-3 pb-8 pt-[calc(var(--header-h)+1rem)] sm:px-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-mono text-lg uppercase tracking-[0.12em]">Perps</h1>
          <p className="font-mono text-[10px] uppercase text-muted">
            {config
              ? `${config.environment} · ${config.chainName} · ${config.chainId}`
              : "Loading network…"}
          </p>
        </div>
        <div className="panel ticks grid min-w-0 xl:h-[max(42rem,calc(100dvh-var(--header-h)-6rem))] xl:grid-cols-[240px_minmax(0,1fr)_400px]">
          <MarketBrowser
            items={instruments}
            selected={selected?.id}
            loading={protocol.loading || markets.loading}
            error={protocol.error ?? markets.error}
            disabled={busy}
            onSelect={(id) => update("pool", id)}
            onRetry={() => void refresh()}
            onCreate={() => update("mode", "create")}
          />
          <section className="flex min-h-0 min-w-0 flex-col bg-[#0a0a12]/60 xl:overflow-y-auto" aria-label="Selected Perps market chart">
            <div className="flex min-h-20 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              {selected && <InstrumentLogo instrument={selected} />}
              <div className="min-w-0 flex-1">
                <h2 className="break-words font-mono text-lg [overflow-wrap:anywhere]">
                  {selected ? `${selected.base}-PERP` : "Select a Perps market"}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {selected?.pool ? `${selected.pool.model.toUpperCase()} reference pool · ${selected.base}/${selected.quote}` : "Oracle market reference"}
                </p>
              </div>
            </div>
            <MarketPriceChart
              key={`perps:${selected?.market?.id ?? "no-market"}:${revision}`}
              marketId={selected?.market?.id ?? null}
              poolAddress={selected?.pool?.address ?? null}
              pairLabel={selected ? `${selected.base}/${selected.quote}` : undefined}
              inverted={Boolean(selected?.pool && selected.base !== selected.pool.token0Symbol)}
              perpsMarketId={perpsMarketId}
              positionLines={positionLines}
            />
            <div className="border-t border-line px-4 py-3 text-xs text-muted">
              Oracle and reference observations are shown for market context. Position execution uses the Perps oracle and current risk limits.
            </div>
          </section>
          <aside className="min-h-0 min-w-0 overflow-x-hidden border-t border-line xl:overflow-y-auto xl:border-l xl:border-t-0" aria-label="Perps actions">
            <PerpsPanel
              selectedPoolAddress={selected?.pool?.address}
              onSelectedPoolChange={(address) => update("pool", address.toLowerCase())}
              onSelectedMarketChange={setPerpsMarketId}
              onPrivatePositionLinesChange={setPrivatePositionLines}
              onBusyChange={setBusy}
              onConfirmed={() => setRevision((value) => value + 1)}
            />
          </aside>
        </div>
        <section className="panel ticks mt-3 min-w-0" aria-label="Perps account and activity">
          <TerminalTabs
            prefix="perps-account"
            label="Perps account panels"
            value={panel}
            disabled={busy}
            onChange={(value) => update("panel", value)}
            items={[
              { value: "positions", label: "Positions" },
              { value: "history", label: "History" },
              { value: "activity", label: "Network activity" },
            ]}
          />
          <div role="tabpanel" id={`perps-account-panel-${panel}`} aria-labelledby={`perps-account-tab-${panel}`}>
            <PerpsAccountWorkspace
              panel={panel}
              revision={revision}
              privatePositionLines={privatePositionLines}
            />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-8 pt-[calc(var(--header-h)+1rem)] sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg uppercase tracking-[0.12em]">Pools</h1>
          <p className="mt-1 text-xs text-muted">
            {config?.shielded
              ? "DAMM and DLMM swaps, liquidity and shielded pool execution."
              : "Public pool swaps and liquidity. Shielded execution remains visible but unavailable on this network."}
          </p>
        </div>
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
          onCreate={() => update("mode", "create")}
        />
        <section
          className="flex min-h-0 min-w-0 flex-col bg-[#0a0a12]/60 xl:overflow-y-auto"
          aria-label="Selected market chart"
        >
          <div className="flex min-h-20 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            {selected && <InstrumentLogo instrument={selected} />}
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-mono text-lg [overflow-wrap:anywhere]">
                {selected
                  ? `${selected.base}/${selected.quote}`
                  : "Select a market"}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {selected?.pool
                  ? `${selected.pool.model.toUpperCase()}${selected.pool.feeBps === null ? " · validated route" : ` · ${selected.pool.feeBps / 100}% pool fee`}`
                  : "Chart browsing · no validated execution pool"}
              </p>
              {selected?.market?.source === "robinhood_stock_token" && selected.market.marketCapUsd ? (
                <p className="mt-1 font-mono text-[10px] uppercase text-faint">
                  On-chain cap · {formatCompactUsd(selected.market.marketCapUsd)}
                </p>
              ) : null}
            </div>
            {selected?.pool && (
              <div className="ml-auto flex items-center gap-2 font-mono text-[9px] uppercase">
                <span className="border border-line px-2 py-1 text-emerald-300">
                  {selected.pool.status}
                </span>
                {config && (
                  <a
                    href={`${config.explorerUrl.replace(/\/$/u, "")}/address/${selected.pool.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 border border-line px-2 py-1 text-muted hover:text-fg"
                    aria-label={`Open ${selected.base}/${selected.quote} pool in explorer`}
                  >
                    Explorer <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </div>
          {selected?.pool && <PoolStatsStrip pool={selected.pool.address} />}
          {selected?.pool ? (
            <div className="flex overflow-x-auto border-b border-line" role="tablist" aria-label="DLMM market view">
              {(selected.pool.model === "dlmm" ? ["chart", "depth", "book", "split"] as const : ["chart", "depth"] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={poolView === view} onClick={() => setPoolView(view)} className={`min-h-10 min-w-20 flex-1 border-b-2 px-3 font-mono text-[10px] uppercase ${poolView === view ? "border-lime bg-lime/10 text-lime" : "border-transparent text-muted hover:text-fg"}`}>{view}</button>)}
            </div>
          ) : null}
          <div className={poolView === "split" ? "grid min-h-0 xl:grid-cols-2" : "min-h-0"}>
            {(poolView === "chart" || poolView === "split") ? (
              <MarketPriceChart
                key={`${selected?.market?.id ?? "no-market"}:${revision}`}
                marketId={selected?.market?.id ?? null}
                poolAddress={selected?.pool?.address ?? null}
                pairLabel={selected ? `${selected.base}/${selected.quote}` : undefined}
                inverted={Boolean(selected?.pool && selected.base !== selected.pool.token0Symbol)}
                poolModel={selected?.pool?.model}
                walletLiquidityBins={selectedWalletLiquidityBins}
              />
            ) : null}
            {selected?.pool?.model === "dlmm" && (poolView === "depth" || poolView === "book" || poolView === "split") ? (
              <DlmmDepthBook
                pool={selected.pool.address}
                base={selected.base}
                quote={selected.quote}
                baseDecimals={selected.base === selected.pool.token0Symbol ? selected.pool.token0Decimals : selected.pool.token1Decimals}
                quoteDecimals={selected.quote === selected.pool.token1Symbol ? selected.pool.token1Decimals : selected.pool.token0Decimals}
                mode={poolView === "depth" ? "depth" : "book"}
              />
            ) : null}
            {selected?.pool?.model === "damm" && poolView === "depth" ? (
              <DammDepthView
                pool={selected.pool.address}
                base={selected.base}
                quote={selected.quote}
                baseDecimals={selected.base === selected.pool.token0Symbol ? selected.pool.token0Decimals : selected.pool.token1Decimals}
                quoteDecimals={selected.quote === selected.pool.token1Symbol ? selected.pool.token1Decimals : selected.pool.token0Decimals}
                inverted={selected.base !== selected.pool.token0Symbol}
              />
            ) : null}
          </div>
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
          onConfirmed={handleConfirmed}
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
            { value: "history", label: "History" },
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
            selectedPoolAddress={selected?.pool?.address}
            onSelectPool={(address) => update("pool", address.toLowerCase())}
          />
        </div>
        <div
          role="tabpanel"
          id="account-panel-history"
          aria-labelledby="account-tab-history"
          hidden={panel !== "history"}
        >
          <TradeHistory
            selectedPoolAddress={selected?.pool?.address}
            revision={revision}
          />
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

function formatCompactUsd(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} USD`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(numeric);
}
