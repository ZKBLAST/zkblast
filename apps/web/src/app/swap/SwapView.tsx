"use client";

import { ExternalLink } from "lucide-react";

import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { ExternalMarketSwapCard } from "@/components/swap/ExternalMarketSwapCard";
import { useProtocolData } from "@/lib/use-protocol-data";

export function SwapView() {
  const { config } = useApp();
  const data = useProtocolData();

  return (
    <div className="mx-auto grid max-w-[1360px] gap-8 px-4 pb-16 pt-[calc(var(--header-h)+2rem)] sm:px-6 lg:grid-cols-[1fr_440px]">
      <section>
        <p className="label">Finalized testnet events</p>
        <h1 className="display mt-3 text-5xl">Recent swaps</h1>
        <div className="mt-6">
          <RealDataState
            loading={data.loading}
            error={data.error}
            empty={!data.swaps.length}
            onRetry={data.refresh}
          />
        </div>
        {data.swaps.length ? (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {data.swaps.map((swap) => (
              <li
                key={`${swap.transaction_hash}:${swap.log_index}`}
                className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]"
              >
                <div>
                  <p className="font-mono text-xs">Block {swap.block_number}</p>
                  <p className="mt-1 text-sm text-muted">
                    Raw input {swap.amount_in_raw} · raw output{" "}
                    {swap.amount_out_raw} · fee {swap.fee_raw}
                  </p>
                </div>
                {config ? (
                  <a
                    href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${swap.transaction_hash}`}
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
        ) : null}
      </section>
      <aside>
        <div className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
          <ExternalMarketSwapCard />
        </div>
      </aside>
    </div>
  );
}
