"use client";
import { motion } from "motion/react";
import { TokenMark } from "@/components/ui/Badges";
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

export function PoolRail() {
  const { pools, loading } = useProtocolData();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ColHead left="Pools" right={`${pools.length} indexed`} />
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <ul className="panel-inset space-y-1.5 p-1.5">
          {pools.slice(0, 8).map((pool, index) => (
            <motion.li
              key={pool.address}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + index * 0.06, duration: 0.5 }}
              className="panel flex items-center gap-2.5 px-2.5 py-2"
            >
              <TokenMark symbol={pool.token0Symbol} size={22} />
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
          {!pools.length && (
            <li className="px-3 py-8 text-center font-mono text-[10px] uppercase text-faint">
              {loading ? "Loading index" : "No validated pools"}
            </li>
          )}
        </ul>
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
  const { swaps, metrics, loading } = useProtocolData();
  void commits;
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
          <ul className="space-y-1.5 p-1.5" aria-live="polite">
            {swaps.slice(0, 7).map((swap, index) => (
              <motion.li
                key={`${swap.transaction_hash}:${swap.log_index}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1 - index * 0.1, y: 0 }}
                className="grid grid-cols-[58px_1fr_auto] items-start gap-x-2 border border-line border-l-2 border-l-steel/50 px-2.5 py-2 font-mono"
              >
                <span className="truncate text-[9.5px] text-faint">
                  {swap.block_number}
                </span>
                <span className="min-w-0">
                  <span className="text-[10px] font-semibold text-fg">
                    SWAP
                  </span>
                  <span className="mt-0.5 block truncate text-[9.5px] text-muted">
                    {swap.transaction_hash}
                  </span>
                </span>
                <span className="text-[9px] uppercase text-lime">indexed</span>
              </motion.li>
            ))}
            {!swaps.length && (
              <li className="px-3 py-8 text-center font-mono text-[10px] uppercase text-faint">
                {loading
                  ? "Loading indexed events"
                  : "No validated swap events"}
              </li>
            )}
          </ul>
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
