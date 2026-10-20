"use client";

import { ExternalLink } from "lucide-react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { AccountPanel } from "@/components/account/AccountPanel";
import { useProtocolData } from "@/lib/use-protocol-data";

export function TradeHistory() {
  const { address, trades, config, connect } = useApp();
  if (!address)
    return (
      <div className="p-5 text-sm text-muted">
        Sign in to view your account history.
        <Button className="ml-3" onClick={connect}>
          Connect wallet
        </Button>
      </div>
    );
  return (
    <div className="p-4">
      <details className="mb-4 border border-line p-3">
        <summary className="cursor-pointer text-sm text-muted">User profile and username</summary>
        <div className="mt-3"><AccountPanel showHistory={false} /></div>
      </details>
      <p className="mb-3 text-xs text-faint">
        Verified receipts saved to this account. Market activity is listed
        separately.
      </p>
      {!trades.length ? (
        <p className="py-4 text-sm text-muted">
          No saved trades for this wallet yet.
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
    </div>
  );
}

export function MarketActivity() {
  const { swaps, metrics } = useProtocolData();
  const { config } = useApp();
  const events = swaps;
  return (
    <div className="p-4">
      <p className="mb-3 text-xs text-faint">
        Network-wide swaps.{" "}
        {metrics?.ready
          ? "Indexer is up to date."
          : "Indexer is catching up; recent receipts may not appear yet."}
      </p>
      {!events.length ? (
        <p className="py-4 text-sm text-muted">No indexed swaps yet.</p>
      ) : null}
      <ul className="divide-y divide-line">
        {events.map((event) => (
          <li
            key={`${event.transaction_hash}:${event.log_index}`}
            className="flex flex-wrap justify-between gap-3 py-3 text-xs"
          >
            <span>Swap · block {event.block_number}</span>
            {config && (
              <a
                className="inline-flex items-center gap-1 text-lime"
                target="_blank"
                rel="noreferrer"
                href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${event.transaction_hash}`}
              >
                Receipt <ExternalLink className="size-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
