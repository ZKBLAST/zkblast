"use client";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";
import { useProtocolData } from "@/lib/use-protocol-data";

export function BinsShowcase() {
  const { pools, loading } = useProtocolData();
  const pool = pools.find((item) => item.model === "dlmm");
  return (
    <section className="mx-auto max-w-[1360px] px-4 pt-32 sm:px-6 md:pt-44">
      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,28rem)] md:items-end">
        <Bay index="03" title="DLMM bins" className="md:col-span-2" />
        <MaskHeading
          lines={["Liquidity,", "in bins."]}
          className="display text-[clamp(2.2rem,4.6vw,3.6rem)]"
        />
        <Reveal>
          <p className="font-mono text-[13.5px] leading-relaxed text-muted">
            DLMM pools split the price range into discrete bins. The
            distribution panel remains visible, but it only renders values after
            validated bin-liquidity records are available from the indexer.
          </p>
        </Reveal>
      </div>
      <div className="mt-14 panel ticks p-5 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4 font-mono text-[13px]">
          <span className="text-muted">
            {pool
              ? `${pool.token0Symbol}/${pool.token1Symbol} · ${pool.feeBps} bps`
              : "No validated DLMM pool"}
          </span>
          <span className="text-faint">
            {loading ? "Loading index" : "Bin distribution not indexed"}
          </span>
        </div>
        <div className="mt-6 grid h-56 place-items-center border border-line bg-[#07070d] sm:h-72">
          <p className="max-w-md px-6 text-center font-mono text-[11px] uppercase leading-relaxed tracking-[0.1em] text-faint">
            No fabricated bin depth is shown. This chart will populate from
            validated on-chain bin records.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-5 font-mono text-[12px] text-muted">
          <span>Below price</span>
          <span className="text-lime">Active bin</span>
          <span>Above price</span>
        </div>
      </div>
    </section>
  );
}
