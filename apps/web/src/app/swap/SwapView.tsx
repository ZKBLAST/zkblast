"use client";

import { ExternalLink } from "lucide-react";

import { useApp } from "@/components/shell/AppProvider";
import { ExternalMarketSwapCard } from "@/components/swap/ExternalMarketSwapCard";
import { Button } from "@/components/ui/Button";
import { ProtocolPoolWorkspace } from "@/components/protocol/ProtocolPoolWorkspace";

export function SwapView() {
  const { address, config, connect, trades } = useApp();

  return (
    <div className="mx-auto grid max-w-[1360px] gap-8 px-4 pb-16 pt-[calc(var(--header-h)+2rem)] sm:px-6 lg:grid-cols-[1fr_440px]">
      <section>
        <p className="label">Authenticated receipts</p>
        <h1 className="display mt-3 text-5xl">Your market swaps</h1>
        {!address ? (
          <div className="panel mt-6 p-6">
            <p className="text-sm text-muted">
              Sign in to load receipt-derived trade history for this wallet.
            </p>
            <Button className="mt-4" onClick={connect}>
              Connect wallet
            </Button>
          </div>
        ) : trades.length ? (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {trades.map((trade) => (
              <li
                key={trade.id}
                className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]"
              >
                <div>
                  <p className="font-mono text-xs uppercase">
                    {trade.action} · {trade.status}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {trade.venue} ·{" "}
                    {new Date(trade.submittedAt).toLocaleString()}
                  </p>
                </div>
                {config && trade.transactionHash ? (
                  <a
                    href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${trade.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-lime"
                  >
                    Receipt <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 border border-line p-5 text-sm text-muted">
            No confirmed market swap is stored for this wallet yet.
          </p>
        )}
      </section>
      <aside>
        <div className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
          <ExternalMarketSwapCard />
          <ProtocolPoolWorkspace mode="swap" />
        </div>
      </aside>
    </div>
  );
}
