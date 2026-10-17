"use client";
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { binsFor, poolById } from "@/data/pools";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";
import { fmtPrice } from "@/lib/format";

export function BinsShowcase() {
  const pool = poolById("weth-usdc-dlmm-10")!;
  const bins = useMemo(() => binsFor(pool, 30), [pool]);
  const max = Math.max(...bins.map((b) => b.base + b.quote));
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const grow = useTransform(scrollYProgress, [0.1, 0.45], [0, 1]);
  const [active, setActive] = useState(0);
  // As you scroll, price drifts and the active bin walks: liquidity converts from one token to the other.
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.round((Math.min(Math.max((v - 0.35) / 0.4, 0), 1) - 0.5) * 16)));
  const activeBin = bins.find((b) => b.offset === active)!;

  return (
    <section ref={ref} className="mx-auto max-w-[1360px] px-4 pt-32 sm:px-6 md:pt-44">
      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,28rem)] md:items-end">
        <Bay index="03" title="DLMM bins" className="md:col-span-2" />
        <MaskHeading lines={["Liquidity,", "in bins."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
        <Reveal>
          <p className="font-mono text-[13.5px] leading-relaxed text-muted">DLMM pools split the price range into discrete bins. Only the active bin holds both tokens. Scroll and watch the price move: bins it crosses flip from one token to the other.</p>
        </Reveal>
      </div>

      <div className="mt-14 panel ticks p-5 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4 font-mono text-[13px]">
          <span className="text-muted">{pool.base}/{pool.quote} · bin step {pool.binStep} bps</span>
          <span><span className="text-faint">active bin price </span><span className="text-lime">{fmtPrice(activeBin.price)}</span></span>
        </div>
        <div className="mt-6 flex h-56 items-end gap-[3px] sm:h-72" aria-hidden>
          {bins.map((b) => {
            const h = (b.base + b.quote) / max;
            const side = b.offset < active ? "quote" : b.offset > active ? "base" : "active";
            return (
              <motion.div key={b.id} className="relative flex-1 origin-bottom" style={{ scaleY: grow, height: `${Math.max(h * 100, 3)}%` }}>
                <div className={`absolute inset-0 rounded-t-[1px] transition-colors duration-300 ${side === "active" ? "bg-lime" : side === "quote" ? "bg-[#3d4566]" : "bg-fg/80"}`} />
              </motion.div>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-5 font-mono text-[12px] text-muted">
          <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-[1px] bg-[#3d4566]" /> {pool.quote} (below price)</span>
          <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-[1px] bg-lime" /> Active bin, both tokens</span>
          <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-[1px] bg-fg/80" /> {pool.base} (above price)</span>
        </div>
      </div>
    </section>
  );
}
