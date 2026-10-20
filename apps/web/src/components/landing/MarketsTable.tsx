"use client";
import { motion } from "motion/react";
import { ArrowUpRight, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bay } from "@/components/ui/Frame";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { TypeTag } from "@/components/ui/Badges";
import { MaskHeading } from "@/components/ui/Reveal";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { cx } from "@/lib/format";

export function MarketsTable() {
  const { pools, loading, error, refresh } = useProtocolData();
  const { items: externalMarkets } = useExternalMarkets();
  const [type, setType] = useState<"all" | "DLMM" | "DAMM">("all");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const rows = pools.filter(
    (pool) => type === "all" || pool.model.toUpperCase() === type,
  );
  const cols =
    "lg:grid-cols-[28px_minmax(0,2.1fr)_1fr_0.85fr_0.95fr_0.95fr_0.75fr_0.65fr_120px_76px]";
  return (
    <section
      aria-label="Markets"
      className="mx-auto max-w-[1392px] px-3 pt-24 sm:px-4 md:pt-32"
    >
      <div className="px-1 sm:px-3">
        <Bay index="01" title="Markets" />
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <MaskHeading
            lines={["Every pool.", "One board."]}
            className="display text-[clamp(2.2rem,4.6vw,3.6rem)]"
          />
          <dl className="grid grid-cols-3 gap-6 border-l border-line pl-6 text-right">
            <Stat label="Pools" value={pools.length} />
            <Stat
              label="DLMM"
              value={pools.filter((pool) => pool.model === "dlmm").length}
            />
            <Stat
              label="DAMM"
              value={pools.filter((pool) => pool.model === "damm").length}
            />
          </dl>
        </div>
      </div>
      <div className="mt-12 flex flex-wrap items-center justify-between gap-3 px-1.5 pb-3">
        <div
          role="tablist"
          aria-label="Pool type"
          className="panel-inset flex p-1"
        >
          {(["all", "DLMM", "DAMM"] as const).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={type === item}
              onClick={() => setType(item)}
              className={cx(
                "relative h-8 cursor-pointer px-4 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors",
                type === item
                  ? "bg-lime text-lime-ink"
                  : "text-muted hover:text-fg",
              )}
            >
              {item === "all" ? "All pools" : item}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          <span
            className="size-1.5 rounded-full bg-lime motion-safe:animate-pulse"
            aria-hidden
          />
          {rows.length} validated markets
        </span>
      </div>
      <div className="panel-inset">
        <div
          role="row"
          className={cx(
            "hidden items-center gap-4 border-b border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint lg:grid",
            cols,
          )}
        >
          <span />
          <span>Market</span>
          <span className="justify-self-end">Status</span>
          <span className="justify-self-end">Model</span>
          <span className="justify-self-end">Created block</span>
          <span className="justify-self-end">Token 0</span>
          <span className="justify-self-end">Token 1</span>
          <span className="justify-self-end">Fee</span>
          <span className="justify-self-end">Address</span>
          <span />
        </div>
        <RealDataState
          loading={loading}
          error={error}
          empty={!rows.length}
          onRetry={refresh}
        />
        {!!rows.length && (
          <ul>
            {rows.map((pool, index) => (
              <motion.li
                key={pool.address}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                className="group border-b border-line last:border-0"
              >
                <div
                  className={cx(
                    "grid grid-cols-[28px_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-4 hover:bg-white/[0.02] lg:min-h-[72px] lg:py-0",
                    cols,
                  )}
                >
                  <button
                    onClick={() =>
                      setFavorites((current) => {
                        const next = new Set(current);
                        if (next.has(pool.address)) next.delete(pool.address);
                        else next.add(pool.address);
                        return next;
                      })
                    }
                    aria-label={`${favorites.has(pool.address) ? "Unstar" : "Star"} ${pool.token0Symbol}/${pool.token1Symbol}`}
                    className="grid size-7 cursor-pointer place-items-center text-faint hover:text-lime"
                  >
                    <Star
                      className={cx(
                        "size-3.5",
                        favorites.has(pool.address) && "fill-lime text-lime",
                      )}
                    />
                  </button>
                  <Link
                    href={`/trade?pool=${pool.address}`}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <ProtocolPairLogo
                      base={pool.token0Symbol}
                      quote={pool.token1Symbol}
                      markets={externalMarkets}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13.5px] text-fg group-hover:text-lime">
                        {pool.token0Symbol}/{pool.token1Symbol}
                      </span>
                      <TypeTag
                        type={pool.model.toUpperCase() as "DLMM" | "DAMM"}
                      />
                    </span>
                  </Link>
                  <Cell value={pool.status.toUpperCase()} accent />
                  <Cell value={pool.model.toUpperCase()} />
                  <Cell value={pool.createdBlock} />
                  <Cell value={pool.token0Symbol} />
                  <Cell value={pool.token1Symbol} />
                  <Cell value={`${pool.feeBps} bps`} />
                  <span className="hidden max-w-[120px] truncate justify-self-end font-mono text-[10px] text-faint lg:block">
                    {pool.address}
                  </span>
                  <Link
                    href="/trade"
                    className="hidden items-center gap-1 justify-self-end border border-line-strong px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted hover:border-lime/60 hover:text-lime lg:inline-flex"
                  >
                    Trade <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-1.5 pt-3">
        <Link
          href="/trade?mode=liquidity"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg/85 hover:text-lime"
        >
          View all pools <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
        {label}
      </dt>
      <dd className="num mt-1 text-xl text-fg">{value}</dd>
    </div>
  );
}
function Cell({ value, accent = false }: { value: string; accent?: boolean }) {
  return (
    <span
      className={cx(
        "hidden justify-self-end font-mono text-[12px] lg:block",
        accent ? "text-lime" : "text-fg/90",
      )}
    >
      {value}
    </span>
  );
}
