"use client";

import { ExternalLink, Layers, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AccountPanel } from "@/components/account/AccountPanel";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { ShieldedPositionsPanel } from "@/components/shielded/ShieldedPositionsPanel";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge, TypeTag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
  type TransactionExecutionState,
} from "@/lib/swap-flow";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import type { ProtocolPosition } from "@/types/application";

export function PositionsView({
  compact = false,
  onSelectPool,
  selectedPoolAddress,
}: {
  compact?: boolean;
  onSelectPool?: (address: string) => void;
  selectedPoolAddress?: string;
} = {}) {
  const { address, connect, config, toast } = useApp();
  const data = useProtocolData(address);
  const { items: externalMarkets } = useExternalMarkets();
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const selected = selectedPoolAddress?.toLowerCase();
  const positions =
    compact && selected && scope === "selected"
      ? data.positions.filter(
          (position) => position.poolAddress.toLowerCase() === selected,
        )
      : data.positions;
  const openPositions = positions.filter((position) => position.status === "open");
  const closedPositions = positions.filter((position) => position.status !== "open");
  const dlmmPools = useMemo(
    () => [...new Set(positions
      .filter((position) => position.model === "dlmm")
      .map((position) => position.poolAddress.toLowerCase()))].sort(),
    [positions],
  );
  const dlmmPoolKey = dlmmPools.join(",");
  const [activeBins, setActiveBins] = useState<Readonly<Record<string, number | null>>>({});

  useEffect(() => {
    const controller = new AbortController();
    if (!dlmmPoolKey) {
      setActiveBins({});
      return () => controller.abort();
    }
    void Promise.all(dlmmPools.map(async (pool) => {
      const response = await apiRequest<{ stats: { activeBin: number | null } | null }>(
        webPublicConfig.apiUrl,
        `/v1/protocol/pools/${encodeURIComponent(pool)}/stats`,
        { signal: controller.signal },
      );
      return [pool, response.stats?.activeBin ?? null] as const;
    })).then((entries) => {
      if (!controller.signal.aborted) setActiveBins(Object.fromEntries(entries));
    }).catch(() => {
      if (!controller.signal.aborted) setActiveBins({});
    });
    return () => controller.abort();
  }, [dlmmPoolKey]);

  if (!address)
    return (
      <>
        {!compact && (
          <PageHeader
            title="Positions"
            lead="Validated liquidity positions belonging to your authenticated wallet."
            badges={<LaneBadge lane="public" />}
          />
        )}
        <div
          className={compact ? "p-4" : "mx-auto max-w-[1360px] px-4 sm:px-6"}
        >
          <ShieldedPositionsPanel />
          <div className="panel flex items-start gap-4 p-8">
            <Layers className="size-5 text-muted" />
            <div>
              <p className="font-semibold">
                Connect a wallet to query positions
              </p>
              <p className="mt-1 text-sm text-muted">
                Your liquidity positions appear here after you sign in.
              </p>
              <Button className="mt-4" onClick={connect}>
                Connect wallet
              </Button>
            </div>
          </div>
        </div>
      </>
    );

  return (
    <>
      {!compact && (
        <PageHeader
          title="Positions"
          lead="Liquidity positions are wallet-scoped. Swaps appear in account trade history and do not create LP positions."
          badges={<LaneBadge lane="public" />}
          aside={
            <dl className="grid grid-cols-2 gap-6">
              <Stat label="Indexed positions" value={data.positions.length} />
              <Stat
                label="Open"
                value={
                  data.positions.filter((item) => item.status === "open").length
                }
              />
            </dl>
          }
        />
      )}
      <div className={compact ? "p-4" : "mx-auto max-w-[1360px] px-4 sm:px-6"}>
        {!compact && <AccountPanel />}
        <ShieldedPositionsPanel />
        {compact && selected && (
          <div className="mb-3 flex gap-2" role="group" aria-label="Position scope">
            {(["selected", "all"] as const).map((value) => (
              <Button
                key={value}
                variant={scope === value ? "primary" : "secondary"}
                onClick={() => setScope(value)}
              >
                {value === "selected" ? "Selected pool" : "All positions"}
              </Button>
            ))}
          </div>
        )}
        <RealDataState
          loading={data.loading}
          error={data.error}
          empty={!positions.length}
          onRetry={data.refresh}
        />
        {!data.loading && !data.error && !positions.length ? (
          <p className="mt-4 border border-line p-4 text-sm text-muted">
            {scope === "selected"
              ? "This wallet has no indexed public liquidity position in the selected pool."
              : "This wallet has no indexed public liquidity position. Completed market swaps remain available in trade history."}
          </p>
        ) : null}
        {openPositions.length ? (
          <section aria-labelledby="open-positions-heading">
            <h3 id="open-positions-heading" className="mb-3 font-mono text-[10px] uppercase text-muted">
              Open positions · {openPositions.length}
            </h3>
            <ul className="space-y-3">
            {openPositions.map((position) => (
              <PositionItem
                key={`${position.poolAddress}:${position.onchainPositionId}`}
                position={position}
                activeBin={activeBins[position.poolAddress.toLowerCase()]}
                markets={externalMarkets}
                owner={address}
                explorerUrl={config?.explorerUrl}
                onConfirmed={data.refresh}
                onToast={toast}
                onSelectPool={onSelectPool}
              />
            ))}
            </ul>
          </section>
        ) : null}
        {closedPositions.length ? (
          <section className={openPositions.length ? "mt-6 border-t border-line pt-5" : ""} aria-labelledby="closed-positions-heading">
            <h3 id="closed-positions-heading" className="mb-3 font-mono text-[10px] uppercase text-muted">
              Closed positions · {closedPositions.length}
            </h3>
            <ul className="space-y-3">
              {closedPositions.map((position) => (
                <PositionItem
                  key={`${position.poolAddress}:${position.onchainPositionId}`}
                  position={position}
                  activeBin={activeBins[position.poolAddress.toLowerCase()]}
                  markets={externalMarkets}
                  owner={address}
                  explorerUrl={config?.explorerUrl}
                  onConfirmed={data.refresh}
                  onToast={toast}
                  onSelectPool={onSelectPool}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

type PreparedAction = Readonly<{
  chainId: number;
  position: PreparedTransaction;
}>;

function PositionItem({
  position,
  activeBin,
  markets,
  owner,
  explorerUrl,
  onConfirmed,
  onToast,
  onSelectPool,
}: Readonly<{
  position: ProtocolPosition;
  activeBin?: number | null;
  markets: ReturnType<typeof useExternalMarkets>["items"];
  owner: string;
  explorerUrl?: string;
  onConfirmed: () => Promise<void>;
  onSelectPool?: (address: string) => void;
  onToast: (value: {
    kind: "success" | "error" | "info";
    title: string;
    body?: string;
  }) => void;
}>) {
  const [percent, setPercent] = useState(100);
  const [state, setState] = useState<
    TransactionExecutionState | "idle" | "preparing" | "failed"
  >("idle");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const shares = (BigInt(position.liquidityRaw) * BigInt(percent)) / 100n;
  const busy = !["idle", "failed", "confirmed"].includes(state);
  const hasRange = position.lowerBound !== null && position.upperBound !== null;
  const inRange = hasRange && activeBin !== null && activeBin !== undefined
    ? activeBin >= position.lowerBound! && activeBin <= position.upperBound!
    : null;

  async function removeLiquidity() {
    if (!window.ethereum || shares <= 0n) return;
    setState("preparing");
    setNotice("");
    try {
      const prepared = await apiRequest<PreparedAction>(
        webPublicConfig.apiUrl,
        "/v1/protocol/positions/decrease",
        {
          method: "POST",
          body: JSON.stringify({
            owner,
            positionId: position.onchainPositionId,
            shares: shares.toString(),
            minimumAmount0: "0",
            minimumAmount1: "0",
            recipient: owner,
            deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
          }),
        },
      );
      const hash = await executeTransactions(
        window.ethereum,
        owner,
        prepared.chainId,
        [prepared.position],
        (next, transaction) => {
          setState(next);
          if (transaction) setTransactionHash(transaction);
        },
        "Remove liquidity",
      );
      setTransactionHash(hash);
      await onConfirmed();
      onToast({
        kind: "success",
        title: "Liquidity removed",
        body: `${percent}% of position ${position.onchainPositionId} was confirmed on-chain.`,
      });
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error, "Liquidity removal"));
    }
  }

  return (
    <li className="panel ticks p-5">
      <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-center">
        <span className="flex items-center gap-3">
          <ProtocolPairLogo
            base={position.token0Symbol}
            quote={position.token1Symbol}
            markets={markets}
          />
          <span>
            <strong>
              {position.token0Symbol}/{position.token1Symbol}
            </strong>
            <span className="mt-1 block font-mono text-xs text-faint">
              Position {position.onchainPositionId}
            </span>
            {onSelectPool && (
              <button
                type="button"
                className="mt-2 cursor-pointer text-xs text-lime"
                disabled={busy}
                onClick={() => onSelectPool(position.poolAddress)}
              >
                View market
              </button>
            )}
          </span>
        </span>
        <TypeTag type={position.model.toUpperCase() as "DAMM" | "DLMM"} />
        <dl className="text-right">
          <dt className="text-xs text-faint">Current LP shares</dt>
          <dd className="num break-all">{position.liquidityRaw}</dd>
          <dd className="mt-1 font-mono text-xs uppercase text-muted">
            {position.status}
          </dd>
        </dl>
      </div>
      {position.model === "dlmm" ? (
        <dl className="mt-4 grid grid-cols-2 gap-px border border-line bg-line text-xs sm:grid-cols-3">
          <div className="bg-panel px-3 py-2">
            <dt className="font-mono text-[9px] uppercase text-faint">Bin range</dt>
            <dd className="mt-1 font-mono text-muted">
              {hasRange ? `${position.lowerBound} – ${position.upperBound}` : "Full range"}
            </dd>
          </div>
          <div className="bg-panel px-3 py-2">
            <dt className="font-mono text-[9px] uppercase text-faint">Active bin</dt>
            <dd className="mt-1 font-mono text-muted">{activeBin ?? "—"}</dd>
          </div>
          <div className="col-span-2 bg-panel px-3 py-2 sm:col-span-1">
            <dt className="font-mono text-[9px] uppercase text-faint">Range status</dt>
            <dd className={`mt-1 font-mono ${inRange === true ? "text-emerald-300" : inRange === false ? "text-amber-300" : "text-muted"}`}>
              {inRange === true ? "In range" : inRange === false ? "Out of range" : "Awaiting finalized bin"}
            </dd>
          </div>
        </dl>
      ) : null}
      {position.status === "open" ? (
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {[25, 50, 75, 100].map((value) => (
            <Button
              key={value}
              variant={percent === value ? "primary" : "secondary"}
              onClick={() => setPercent(value)}
              disabled={busy}
            >
              {value}%
            </Button>
          ))}
          <Button
            className="sm:ml-auto"
            variant="secondary"
            disabled={busy || shares <= 0n}
            onClick={() => void removeLiquidity()}
          >
            <Minus className="size-4" />
            {busy ? state.replaceAll("-", " ") : "Remove liquidity"}
          </Button>
        </div>
        <p className="mt-3 break-all font-mono text-xs text-faint">
          Removing {shares.toString()} shares · pool {position.poolAddress}
        </p>
        {notice ? <p className="mt-3 text-sm text-danger">{notice}</p> : null}
        {transactionHash && explorerUrl ? (
          <a
            className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-lime"
            href={`${explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View receipt <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      ) : (
        <div className="mt-4 border-t border-line pt-4 text-xs text-muted">
          <p>This position is closed. Its canonical record remains visible for account history.</p>
          {position.closedAt ? (
            <p className="mt-1 font-mono text-faint">
              Closed {new Date(position.closedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}
