"use client";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useDlmmBins } from "@/lib/use-dlmm-bins";

export function BinsShowcase() {
  const { pools, loading } = useProtocolData();
  const pool = pools.find((item) => item.model === "dlmm");
  const bins = useDlmmBins(pool?.address);
  const maximum =
    bins.data?.bins.reduce(
      (max, bin) =>
        BigInt(bin.totalShares) > max ? BigInt(bin.totalShares) : max,
      1n,
    ) ?? 1n;
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
            Concentrate liquidity around your chosen price. Each bin holds its
            own reserves, and the active bin moves as swaps cross the range.
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
            {loading || bins.loading
              ? "Loading liquidity"
              : bins.data
                ? `Active bin ${bins.data.activeBin} · ${bins.data.binStepBps} bps step`
                : "Awaiting bin liquidity"}
          </span>
        </div>
        <div
          className="mt-6 flex h-56 items-end justify-center gap-1 border border-line bg-[#07070d] px-5 pb-8 pt-6 sm:h-72"
          aria-label="On-chain DLMM liquidity distribution"
        >
          {bins.data ? (
            bins.data.bins.map((bin) => (
              <div
                key={bin.binId}
                className="relative h-full min-w-0 flex-1"
                title={`Bin ${bin.binId}: ${bin.totalShares} shares`}
              >
                <span
                  className={`absolute bottom-0 block w-full border-t ${bin.binId === bins.data?.activeBin ? "border-lime bg-lime/60" : "border-steel/60 bg-steel/25"}`}
                  style={{
                    height: `${Math.max(1, Number((BigInt(bin.totalShares) * 10000n) / maximum) / 100)}%`,
                  }}
                />
                {bin.binId === bins.data?.activeBin ? (
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[9px] text-lime">
                    {bin.binId}
                  </span>
                ) : null}
              </div>
            ))
          ) : (
            <p className="m-auto px-6 text-center font-mono text-xs text-faint">
              {bins.error ??
                (loading || bins.loading
                  ? "Loading on-chain reserves"
                  : "Liquidity distribution will appear when a DLMM pool is available.")}
            </p>
          )}
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
