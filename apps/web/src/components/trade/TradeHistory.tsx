"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { AccountPanel } from "@/components/account/AccountPanel";
import { useProtocolData } from "@/lib/use-protocol-data";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import type { ProtocolActivity } from "@/types/application";

type PoolTrade = Readonly<{
  transactionHash: string;
  logIndex: number;
  blockNumber: string;
  observedAt: string;
  side: "buy" | "sell" | null;
  trader: string | null;
  privacy: "public" | "shielded" | "unattributed";
  volumeQuoteRaw: string;
  price: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  priceUnit: string;
}>;

const activityLabels: Readonly<Record<string, string>> = {
  PoolCreated: "Pool created",
  PoolRegistered: "Pool registered",
  Swap: "Swap",
  SwapRouted: "Routed swap",
  PositionCreated: "Position opened",
  PositionIncreased: "Liquidity added",
  PositionDecreased: "Liquidity removed",
  PositionTransferred: "Position transferred",
  LiquidityAdded: "Liquidity added",
  LiquidityRemoved: "Liquidity removed",
  BinLiquidityAdded: "DLMM liquidity added",
  BinLiquidityRemoved: "DLMM liquidity removed",
  ProtocolFeesCollected: "Fees claimed",
  CommitmentDeposited: "Shielded deposit",
  Deposited: "Private deposit",
  Withdrawn: "Private withdrawal",
  NoteWithdrawn: "Shielded withdrawal",
  NoteInserted: "Private note created",
  AggregateLiquidityInvested: "Shielded liquidity added",
  AggregateLiquidityDivested: "Shielded liquidity removed",
  AggregatePositionIncreased: "Shielded LP increased",
  AggregatePositionDecreased: "Shielded LP decreased",
  EmergencyExit: "Shielded LP recovered",
  IntentReserved: "Private transaction submitted",
  IntentSettled: "Private transaction completed",
  IntentRefunded: "Private transaction recovered",
};

function activityLabel(event: ProtocolActivity) {
  return activityLabels[event.eventName] ?? event.eventName;
}

function ActivityRows({ items }: { items: readonly ProtocolActivity[] }) {
  const { config } = useApp();
  return (
    <ul className="divide-y divide-line">
      {items.map((event) => (
        <li
          key={`${event.transactionHash}:${event.logIndex}`}
          className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>{activityLabel(event)}</span>
            <span className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
              {event.kind.replaceAll("_", " ")}
            </span>
            <span className="text-faint">Block {event.blockNumber}</span>
          </span>
          {config && (
            <a
              className="inline-flex items-center gap-1 text-lime"
              target="_blank"
              rel="noreferrer"
              href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${event.transactionHash}`}
            >
              Receipt <ExternalLink className="size-3" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function SelectedPoolTradeTape({
  pool,
  revision,
}: {
  pool?: string;
  revision: number;
}) {
  const { config } = useApp();
  const [items, setItems] = useState<readonly PoolTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!pool) {
      setItems([]);
      return () => controller.abort();
    }
    setLoading(true);
    setFailed(false);
    void apiRequest<{ items: PoolTrade[] }>(
      webPublicConfig.apiUrl,
      `/v1/protocol/pools/${encodeURIComponent(pool)}/trades?limit=25`,
      { signal: controller.signal },
    ).then((response) => setItems(response.items)).catch(() => {
      if (!controller.signal.aborted) {
        setItems([]);
        setFailed(true);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [pool, revision]);
  if (!pool) return null;
  return (
    <section className="mb-5 border border-line" aria-label="Selected pool trades">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="font-mono text-[10px] uppercase text-muted">Selected pool trades</p>
        <span className="font-mono text-[9px] text-faint">{items.length} indexed</span>
      </div>
      {loading ? (
        <div className="h-20 animate-pulse bg-white/[0.025]" aria-label="Loading selected pool trades" />
      ) : failed ? (
        <p className="px-3 py-4 text-xs text-danger">
          Pool trades could not be loaded. Refresh this panel to try again.
        </p>
      ) : items.length ? (
        <ul className="divide-y divide-line">
          {items.map((trade) => (
            <li key={`${trade.transactionHash}:${trade.logIndex}`} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">
              <span className={trade.side === "sell" ? "text-rose-300" : "text-emerald-300"}>
                {(trade.side ?? "trade").toUpperCase()}
              </span>
              <span className="truncate font-mono text-faint">
                {trade.privacy === "shielded" ? "Shielded vault" : trade.trader ?? "Unattributed"}
              </span>
              <span className="font-mono">{trade.price} {trade.priceUnit}</span>
              {config && (
                <a className="inline-flex items-center gap-1 text-lime" target="_blank" rel="noreferrer" href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${trade.transactionHash}`}>
                  Receipt <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-xs text-muted">No indexed trades for the selected pool.</p>
      )}
    </section>
  );
}

export function TradeHistory({
  selectedPoolAddress,
  revision = 0,
}: {
  selectedPoolAddress?: string;
  revision?: number;
}) {
  const { address, trades, config, connect } = useApp();
  const { accountActivity, loading } = useProtocolData(address);
  if (!address)
    return (
      <div className="p-5 text-sm text-muted">
        <SelectedPoolTradeTape pool={selectedPoolAddress} revision={revision} />
        <p>
          Sign in to view your account history.
          <Button className="ml-3" onClick={connect}>Connect wallet</Button>
        </p>
      </div>
    );
  return (
    <div className="p-4">
      <details className="mb-4 border border-line p-3">
        <summary className="cursor-pointer text-sm text-muted">User profile and username</summary>
        <div className="mt-3"><AccountPanel showHistory={false} /></div>
      </details>
      <p className="mb-3 text-xs text-faint">
        Wallet activity validated from receipts and indexed protocol events.
      </p>
      <SelectedPoolTradeTape pool={selectedPoolAddress} revision={revision} />
      {!trades.length && !accountActivity.length && !loading ? (
        <p className="py-4 text-sm text-muted">
          No indexed activity for this wallet yet.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {trades.map((trade) => (
          <li
            key={trade.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <span>
              {trade.action} · {trade.status}
              <span className="ml-2 text-xs text-faint">
                {new Date(trade.submittedAt).toLocaleString()}
              </span>
            </span>
            {trade.transactionHash && config ? (
              <a
                className="inline-flex items-center gap-1 text-xs text-lime"
                target="_blank"
                rel="noreferrer"
                href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${trade.transactionHash}`}
              >
                Receipt <ExternalLink className="size-3" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {accountActivity.length ? (
        <div className={trades.length ? "mt-4 border-t border-line pt-2" : ""}>
          <ActivityRows items={accountActivity} />
        </div>
      ) : null}
    </div>
  );
}

export function MarketActivity() {
  const { activity, metrics, loading } = useProtocolData();
  return (
    <div className="p-4">
      <p className="mb-3 text-xs text-faint">
        Network-wide pool, swap, liquidity, fee and Shielded events. {" "}
        {metrics?.ready
          ? "Indexer is up to date."
          : "Indexer is catching up; recent receipts may not appear yet."}
      </p>
      {!activity.length && !loading ? (
        <p className="py-4 text-sm text-muted">No indexed activity yet.</p>
      ) : null}
      <ActivityRows items={activity} />
    </div>
  );
}
