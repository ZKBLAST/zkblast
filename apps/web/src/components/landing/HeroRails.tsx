"use client";
import { motion } from "motion/react";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { useProtocolData } from "@/lib/use-protocol-data";

function ColHead({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg/80">
        {left}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
        {right}
      </span>
    </div>
  );
}

function ColFoot({ text }: { text: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
      <span className="relative grid size-2 place-items-center" aria-hidden>
        <span className="absolute size-2 bg-lime/40 motion-safe:animate-ping" />
        <span className="size-1.5 bg-lime" />
      </span>
      {text}
    </div>
  );
}

function RailShimmer({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 p-1.5" aria-label="Loading live data" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="panel flex h-[58px] items-center gap-3 px-2.5">
          <span className="logo-shimmer size-9 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="logo-shimmer block h-2.5 w-2/3 rounded-sm" />
            <span className="logo-shimmer block h-2 w-1/2 rounded-sm opacity-60" />
          </span>
          <span className="logo-shimmer h-2.5 w-12 rounded-sm opacity-60" />
        </div>
      ))}
    </div>
  );
}

export function PoolRail() {
  const { pools, loading } = useProtocolData();
  const { items: markets } = useExternalMarkets();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColHead left="Pools" right={`${pools.length} indexed`} />
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div className="panel-inset min-h-full">
        {loading && !pools.length ? <RailShimmer rows={6} /> : <ul className="space-y-1.5 p-1.5">
          {pools.slice(0, 8).map((pool, index) => (
            <motion.li
              key={pool.address}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + index * 0.06, duration: 0.5 }}
              className="panel flex items-center gap-2.5 px-2.5 py-2"
            >
              <ProtocolPairLogo
                base={pool.token0Symbol}
                quote={pool.token1Symbol}
                markets={markets}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-fg">
                  {pool.token0Symbol}/{pool.token1Symbol}
                </p>
                <p className="font-mono text-[9.5px] uppercase text-faint">
                  {pool.model} · {pool.feeBps} bps
                </p>
              </div>
              <div className="w-[68px] text-right">
                <p className="truncate font-mono text-[9px] uppercase text-lime">
                  {pool.status}
                </p>
                <p className="font-mono text-[8px] text-faint">
                  #{pool.createdBlock}
                </p>
              </div>
            </motion.li>
          ))}
          {!loading && !pools.length && (
            <li className="px-3 py-8 text-center font-mono text-[10px] uppercase text-faint">
              Pool registry is synchronizing
            </li>
          )}
        </ul>}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a0a12] to-transparent"
        />
      </div>
      <ColFoot text="Validated pool registry" />
    </div>
  );
}

export function EventStream({
  commits,
}: {
  commits: { leaf: number; root: string }[];
}) {
  const { swaps, pools, metrics, loading } = useProtocolData();
  void commits;
  const operationalEvents = [
    {
      id: "pool-registry",
      block: metrics?.indexedBlock ?? "—",
      type: "POOL_REGISTRY",
      text: `${pools.length} registered routes available`,
      state: metrics?.ready ? "synced" : "tracking",
    },
    {
      id: "router",
      block: metrics?.indexedBlock ?? "—",
      type: "ROUTER",
      text: "DAMM and DLMM routing path active",
      state: "ready",
    },
    {
      id: "nullifier",
      block: metrics?.finalizedBlock ?? metrics?.indexedBlock ?? "—",
      type: "NULLIFIER_REGISTRY",
      text: "Spend protection registry connected",
      state: "watching",
    },
    {
      id: "verifier",
      block: metrics?.finalizedBlock ?? metrics?.indexedBlock ?? "—",
      type: "PROOF_VERIFIER",
      text: "Withdrawal verification path available",
      state: "ready",
    },
  ];
  const events = [
    ...swaps.slice(0, 7).map((swap) => ({
      id: `${swap.transaction_hash}:${swap.log_index}`,
      block: swap.block_number,
      type: "SWAP",
      text: swap.transaction_hash,
      state: "indexed",
    })),
    ...operationalEvents,
  ].slice(0, 7);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColHead
        left="Event stream"
        right={metrics?.ready ? "synced" : "indexing"}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div className="panel-inset relative h-full overflow-hidden">
          <div className="grid grid-cols-[58px_1fr_auto] border-b border-line px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            <span>Block</span>
            <span>Event</span>
            <span>State</span>
          </div>
          {loading && !swaps.length ? <RailShimmer rows={6} /> : <ul className="space-y-1.5 p-1.5" aria-live="polite">
            {events.map((event, index) => (
              <motion.li
                key={event.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1 - index * 0.1, y: 0 }}
                className="grid grid-cols-[58px_1fr_auto] items-start gap-x-2 border border-line border-l-2 border-l-steel/50 px-2.5 py-2 font-mono"
              >
                <span className="truncate text-[9.5px] text-faint">
                  {event.block}
                </span>
                <span className="min-w-0">
                  <span className="text-[10px] font-semibold text-fg">
                    {event.type}
                  </span>
                  <span className="mt-0.5 block truncate text-[9.5px] text-muted">
                    {event.text}
                  </span>
                </span>
                <span className="text-[9px] uppercase text-lime">{event.state}</span>
              </motion.li>
            ))}
          </ul>}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-steel/[0.05] to-transparent motion-safe:animate-[scanline_4.5s_linear_infinite]"
          />
        </div>
      </div>
      <ColFoot text={`Indexed block ${metrics?.indexedBlock ?? "pending"}`} />
    </div>
  );
}
