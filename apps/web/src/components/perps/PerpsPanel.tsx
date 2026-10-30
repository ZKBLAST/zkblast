"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/components/shell/AppProvider";
import { executeTransactions, type PreparedTransaction } from "@/lib/swap-flow";
import { PrivatePerpsPanel } from "./PrivatePerpsPanel";

type PerpMarket = Readonly<{
  marketId: string;
  symbol: string;
  maxOpenInterestRaw: string;
  maxPositionRaw: string;
  minPositionRaw: string;
  maxLeverageBps: number;
  maintenanceMarginBps: number;
  positionFeeBps: number;
  enabled: boolean;
  paused: boolean;
  currentPriceX18: string | null;
  oracleUpdatedAt: string | null;
  longOpenInterestRaw: string;
  shortOpenInterestRaw: string;
  fundingRateBpsPerHour: number;
  fundingIndexX18: string;
}>;

type VaultSnapshot = Readonly<{
  lpAssetsRaw: string;
  availableLiquidityRaw: string;
  insuranceAssetsRaw: string;
}>;

type PerpCatalogMarket = Readonly<{
  poolAddress: string;
  poolModel: "damm" | "dlmm";
  baseSymbol: string;
  quoteSymbol: string;
  marketId: string | null;
  executionStatus: "executable" | "oracle_required" | "market_paused" | "pool_unavailable";
}>;

type PerpPosition = Readonly<{
  positionId: `0x${string}`;
  marketId: `0x${string}`;
  isLong: boolean;
  marginRaw: string;
  notionalRaw: string;
  entryPriceX18: string;
  status: "open" | "closed" | "liquidated";
  openedTransactionHash: `0x${string}`;
}>;

type PerpActivity = Readonly<{
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: string;
  blockTimestamp: string;
  eventKind: string;
  marketId: string | null;
  positionId: string | null;
  payload: Readonly<Record<string, string | number | boolean | null>>;
}>;

function usd(raw?: string) {
  if (!raw) return "—";
  return `${(Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDG`;
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function PerpsPanel({
  onBusyChange,
  onConfirmed,
  selectedPoolAddress,
  onSelectedPoolChange,
}: Readonly<{
  onBusyChange: (busy: boolean) => void;
  onConfirmed: () => void;
  selectedPoolAddress?: string;
  onSelectedPoolChange?: (poolAddress: string) => void;
}>) {
  const { config, injectedAddress, address, openWallet, toast } = useApp();
  const [markets, setMarkets] = useState<readonly PerpMarket[]>([]);
  const [catalog, setCatalog] = useState<readonly PerpCatalogMarket[]>([]);
  const [selectedPool, setSelectedPool] = useState("");
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [positions, setPositions] = useState<readonly PerpPosition[]>([]);
  const [activity, setActivity] = useState<readonly PerpActivity[]>([]);
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("0.05");
  const [leverage, setLeverage] = useState(1);
  const [executionMode, setExecutionMode] = useState<"public" | "shielded">("public");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executionState, setExecutionState] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const wallet = injectedAddress ?? address;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<{ items: PerpMarket[] }>(webPublicConfig.apiUrl, "/v1/perps/markets", {
        signal: controller.signal,
      }),
      apiRequest<{ vault: VaultSnapshot | null }>(webPublicConfig.apiUrl, "/v1/perps/vault", {
        signal: controller.signal,
      }),
      apiRequest<{ items: PerpCatalogMarket[] }>(webPublicConfig.apiUrl, "/v1/perps/catalog", {
        signal: controller.signal,
      }),
      wallet
        ? apiRequest<{ items: PerpPosition[] }>(
            webPublicConfig.apiUrl,
            `/v1/perps/positions?ownerAddress=${encodeURIComponent(wallet)}`,
            { signal: controller.signal },
          )
        : Promise.resolve({ items: [] }),
      wallet
        ? apiRequest<{ items: PerpActivity[] }>(
            webPublicConfig.apiUrl,
            `/v1/perps/activity?ownerAddress=${encodeURIComponent(wallet)}&limit=10`,
            { signal: controller.signal },
          )
        : Promise.resolve({ items: [] }),
    ])
      .then(([marketResponse, vaultResponse, catalogResponse, positionResponse, activityResponse]) => {
        setMarkets(marketResponse.items);
        setVault(vaultResponse.vault);
        setCatalog(catalogResponse.items);
        setSelectedPool((current) => {
          const requested = catalogResponse.items.find(
            (item) => item.poolAddress.toLowerCase() === selectedPoolAddress?.toLowerCase(),
          )?.poolAddress;
          return requested || current || catalogResponse.items.find((item) => item.executionStatus === "executable")?.poolAddress || catalogResponse.items[0]?.poolAddress || "";
        });
        setPositions(positionResponse.items);
        setActivity(activityResponse.items);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "UNAVAILABLE");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, selectedPoolAddress, wallet]);

  const selectedCatalog = catalog.find((item) => item.poolAddress === selectedPool);
  const market = markets.find((item) => item.marketId === selectedCatalog?.marketId);
  const maximumLeverage = Math.max(1, Math.floor((market?.maxLeverageBps ?? 10_000) / 10_000));
  const notional = useMemo(() => {
    const value = Number(margin);
    return Number.isFinite(value) ? value * leverage : 0;
  }, [leverage, margin]);
  const executable = Boolean(market?.enabled && !market.paused);
  const marginRaw = Number.isFinite(Number(margin))
    ? Math.round(Number(margin) * 1e6)
    : 0;
  const positionRaw = marginRaw * leverage;
  const amountError = !marginRaw
    ? "Enter a margin amount"
    : market && positionRaw < Number(market.minPositionRaw)
      ? `Minimum position size is ${usd(market.minPositionRaw)}`
      : market && positionRaw > Number(market.maxPositionRaw)
        ? `Maximum position size is ${usd(market.maxPositionRaw)}`
        : null;
  const liquidationPrice = useMemo(() => {
    if (!market?.currentPriceX18 || leverage <= 0) return null;
    const price = Number(market.currentPriceX18) / 1e18;
    const maintenance = market.maintenanceMarginBps / 10_000;
    const move = Math.max(0, 1 / leverage - maintenance);
    return side === "long" ? price * (1 - move) : price * (1 + move);
  }, [leverage, market, side]);
  async function submit() {
    if (!wallet || !window.ethereum || !config) {
      openWallet();
      return;
    }
    if (!market?.currentPriceX18) return;
    const marginRaw = BigInt(Math.round(Number(margin) * 1e6));
    if (marginRaw <= 0n) return;
    const indexPrice = BigInt(market.currentPriceX18);
    const acceptablePrice =
      side === "long" ? (indexPrice * 10_100n) / 10_000n : (indexPrice * 9_900n) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1_200);
    onBusyChange(true);
    setExecutionState("Preparing position");
    try {
      const prepared = await apiRequest<{
        chainId: number;
        transactions: PreparedTransaction[];
      }>(webPublicConfig.apiUrl, "/v1/perps/prepare/open", {
        method: "POST",
        body: JSON.stringify({
          positionId: randomBytes32(),
          ownerCommitment: randomBytes32(),
          marketId: market.marketId,
          marginRaw: marginRaw.toString(),
          leverageBps: leverage * 10_000,
          acceptablePriceX18: acceptablePrice.toString(),
          deadline: deadline.toString(),
          isLong: side === "long",
        }),
      });
      await executeTransactions(
        window.ethereum,
        wallet,
        prepared.chainId,
        prepared.transactions,
        (state) => setExecutionState(state.replaceAll("-", " ")),
        `Open ${market.symbol}`,
      );
      setExecutionState("Position confirmed");
      setRefreshKey((value) => value + 1);
      onConfirmed();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "POSITION_OPEN_FAILED";
      setExecutionState(null);
      toast({ kind: "error", title: "Position could not be opened", body: message });
    } finally {
      onBusyChange(false);
    }
  }

  async function closePosition(position: PerpPosition) {
    if (!wallet || !window.ethereum || !config) {
      openWallet();
      return;
    }
    const positionMarket = markets.find((item) => item.marketId === position.marketId);
    if (!positionMarket?.currentPriceX18) return;
    const indexPrice = BigInt(positionMarket.currentPriceX18);
    const acceptablePrice = position.isLong
      ? (indexPrice * 9_900n) / 10_000n
      : (indexPrice * 10_100n) / 10_000n;
    onBusyChange(true);
    setExecutionState("Preparing close");
    try {
      const prepared = await apiRequest<{
        chainId: number;
        transactions: PreparedTransaction[];
      }>(webPublicConfig.apiUrl, "/v1/perps/prepare/close", {
        method: "POST",
        body: JSON.stringify({
          positionId: position.positionId,
          payoutCommitment: randomBytes32(),
          acceptablePriceX18: acceptablePrice.toString(),
          deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
          recipient: wallet,
        }),
      });
      await executeTransactions(
        window.ethereum,
        wallet,
        prepared.chainId,
        prepared.transactions,
        (state) => setExecutionState(state.replaceAll("-", " ")),
        `Close ${positionMarket.symbol}`,
      );
      setExecutionState("Position closed");
      setRefreshKey((value) => value + 1);
      onConfirmed();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "POSITION_CLOSE_FAILED";
      setExecutionState(null);
      toast({ kind: "error", title: "Position could not be closed", body: message });
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Perpetuals</p>
        <h3 className="mt-1 font-mono text-lg">{market?.symbol ?? "WETH-PERP"}</h3>
        <p className="mt-1 text-xs text-muted">{selectedCatalog ? `${selectedCatalog.poolModel.toUpperCase()} · ${selectedCatalog.baseSymbol}/${selectedCatalog.quoteSymbol}` : "USDG collateral"} · independent oracle · capped exposure</p>
      </div>

      <div className="grid grid-cols-2 border border-line p-1" role="tablist" aria-label="Perps execution mode">
        {(["public", "shielded"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={executionMode === mode}
            onClick={() => setExecutionMode(mode)}
            className={`h-9 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${executionMode === mode ? "bg-fg text-bg" : "text-muted hover:bg-raised hover:text-fg"}`}
          >
            {mode === "public" ? "Public position" : "Shielded position"}
          </button>
        ))}
      </div>

      {executionMode === "shielded" ? (
        <PrivatePerpsPanel
          marketLabel={market?.symbol ?? "Perpetual"}
          marketId={market?.marketId as `0x${string}` | undefined}
          currentPriceX18={market?.currentPriceX18 ?? null}
          side={side}
          margin={margin}
          leverage={leverage}
          maximumLeverage={maximumLeverage}
          onSideChange={setSide}
          onMarginChange={setMargin}
          onLeverageChange={setLeverage}
        />
      ) : loading ? (
        <div className="space-y-2" aria-label="Loading Perps market">
          <div className="h-12 animate-pulse bg-raised" />
          <div className="h-28 animate-pulse bg-raised" />
          <div className="h-12 animate-pulse bg-raised" />
        </div>
      ) : error ? (
        <p className="border border-danger/40 bg-danger/10 p-3 text-xs text-danger">Perps data unavailable · {error}</p>
      ) : (
        <>
          <label className="block text-xs text-muted">
            Perpetual market
            <select
              value={selectedPool}
              onChange={(event) => {
                setSelectedPool(event.target.value);
                onSelectedPoolChange?.(event.target.value);
              }}
              className="mt-2 h-11 w-full border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-lime/70"
            >
              <optgroup label="Available now">
                {catalog.filter((item) => item.executionStatus === "executable").map((item) => (
                  <option key={item.poolAddress} value={item.poolAddress}>
                    {item.baseSymbol}/{item.quoteSymbol} · {item.poolModel.toUpperCase()}
                  </option>
                ))}
              </optgroup>
              {catalog.some((item) => item.executionStatus !== "executable") && (
                <optgroup label="More markets">
                  {catalog.filter((item) => item.executionStatus !== "executable").map((item) => (
                    <option key={item.poolAddress} value={item.poolAddress} disabled>
                      {item.baseSymbol}/{item.quoteSymbol} · not active
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["long", "short"] as const).map((value) => {
              const Icon = value === "long" ? ArrowUpRight : ArrowDownRight;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={side === value}
                  onClick={() => setSide(value)}
                  className={`flex h-11 items-center justify-center gap-2 border font-mono text-xs uppercase ${side === value ? "border-lime bg-lime/15 text-lime" : "border-line text-muted hover:bg-raised"}`}
                >
                  <Icon className="size-4" aria-hidden /> {value}
                </button>
              );
            })}
          </div>

          <label className="block text-xs text-muted">
            Margin
            <div className="mt-2 flex items-center border border-line bg-black/20 focus-within:border-lime/70">
              <input
                value={margin}
                inputMode="decimal"
                onChange={(event) => setMargin(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-base outline-none"
                aria-label="Position margin in USDG"
              />
              <span className="px-3 font-mono text-xs text-muted">USDG</span>
            </div>
          </label>

          {amountError && (
            <p className="border border-line bg-raised px-3 py-2 text-xs text-muted" role="status">
              {amountError}
            </p>
          )}

          <label className="block text-xs text-muted">
            Leverage <span className="float-right font-mono text-fg">{leverage}x</span>
            <input
              type="range"
              min={1}
              max={maximumLeverage}
              step={1}
              value={Math.min(leverage, maximumLeverage)}
              onChange={(event) => setLeverage(Number(event.target.value))}
              className="mt-3 w-full accent-lime"
            />
          </label>

          <dl className="space-y-2 border-y border-line py-3 font-mono text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-muted">Position size</dt><dd>{notional.toFixed(4)} USDG</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Position fee</dt><dd>{((notional * (market?.positionFeeBps ?? 0)) / 10_000).toFixed(6)} USDG</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Oracle price</dt><dd>{market?.currentPriceX18 ? `$${(Number(market.currentPriceX18) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Estimated liquidation</dt><dd>{liquidationPrice === null ? "—" : `$${liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Funding / hour</dt><dd>{((market?.fundingRateBpsPerHour ?? 0) / 100).toFixed(4)}%</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Long / short OI</dt><dd>{usd(market?.longOpenInterestRaw)} / {usd(market?.shortOpenInterestRaw)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Maintenance margin</dt><dd>{((market?.maintenanceMarginBps ?? 0) / 100).toFixed(2)}%</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Available liquidity</dt><dd>{usd(vault?.availableLiquidityRaw)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Insurance</dt><dd>{usd(vault?.insuranceAssetsRaw)}</dd></div>
          </dl>

          <button
            type="button"
            disabled={!executable || !market?.currentPriceX18 || Boolean(executionState) || Boolean(amountError)}
            onClick={() => void submit()}
            className="flex h-12 w-full items-center justify-center gap-2 bg-fg font-mono text-xs font-bold uppercase tracking-[0.12em] text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Activity className="size-4" aria-hidden />
            {executionState ?? (!wallet ? "Connect wallet" : executable ? `Open ${side}` : "Market activation pending")}
          </button>

          {wallet && (
            <section className="space-y-2 border-t border-line pt-4" aria-labelledby="perps-positions-title">
              <div className="flex items-center justify-between gap-3">
                <h4 id="perps-positions-title" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  Open positions
                </h4>
                <button
                  type="button"
                  onClick={() => setRefreshKey((value) => value + 1)}
                  className="font-mono text-[10px] uppercase text-muted hover:text-fg"
                >
                  Refresh
                </button>
              </div>
              {positions.filter((position) => position.status === "open").length === 0 ? (
                <p className="text-xs leading-relaxed text-muted">No indexed public positions for this wallet.</p>
              ) : (
                positions
                  .filter((position) => position.status === "open")
                  .map((position) => {
                    const positionMarket = markets.find((item) => item.marketId === position.marketId);
                    return (
                      <article key={position.positionId} className="space-y-2 border border-line bg-black/20 p-3">
                        <div className="flex items-start justify-between gap-3 font-mono text-xs">
                          <div>
                            <p>{positionMarket?.symbol ?? "Perpetual"}</p>
                            <p className={position.isLong ? "text-lime" : "text-danger"}>{position.isLong ? "Long" : "Short"}</p>
                          </div>
                          <div className="text-right">
                            <p>{usd(position.marginRaw)}</p>
                            <p className="text-muted">{usd(position.notionalRaw)} size</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(executionState) || !positionMarket?.currentPriceX18}
                          onClick={() => void closePosition(position)}
                          className="h-10 w-full border border-line font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Close position
                        </button>
                      </article>
                    );
                  })
              )}
            </section>
          )}
          {wallet && positions.some((position) => position.status !== "open") && (
            <section className="space-y-2 border-t border-line pt-4" aria-labelledby="perps-history-title">
              <h4 id="perps-history-title" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Position history
              </h4>
              {positions
                .filter((position) => position.status !== "open")
                .slice(0, 5)
                .map((position) => (
                  <div key={position.positionId} className="flex items-center justify-between gap-3 border-b border-line py-2 font-mono text-[10px]">
                    <span>{markets.find((item) => item.marketId === position.marketId)?.symbol ?? "Perpetual"} · {position.isLong ? "Long" : "Short"}</span>
                    <span className="uppercase text-muted">{position.status}</span>
                  </div>
                ))}
            </section>
          )}
          {wallet && activity.length > 0 && (
            <section className="space-y-2 border-t border-line pt-4" aria-labelledby="perps-activity-title">
              <h4 id="perps-activity-title" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Perps activity
              </h4>
              {activity.map((item) => (
                <a
                  key={`${item.transactionHash}:${item.logIndex}`}
                  href={`${config?.explorerUrl ?? ""}/tx/${item.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 border-b border-line py-2 font-mono text-[10px] hover:text-lime"
                >
                  <span className="uppercase">{item.eventKind.replaceAll("_", " ")}</span>
                  <span className="text-muted">Block {item.blockNumber}</span>
                </a>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
