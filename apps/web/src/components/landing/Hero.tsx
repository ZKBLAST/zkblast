"use client";
import { AnimatePresence, motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { easeOut } from "@/lib/motion";
import { MerkleField } from "./MerkleField";
import { EventStream, PoolRail } from "./HeroRails";
import { Ticker } from "./Ticker";

const words = ["LIQUIDITY", "SWAPS", "NOTES", "YIELD"];

// The centre word rolls through what you can move without exposure, like a drum counter.
function Drum() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((v) => (v + 1) % words.length), 2400);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <span className="relative block h-[1.1em] overflow-hidden" aria-live="off">
      <span className="sr-only">{words[0]}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[i]}
          aria-hidden
          className="block"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.55, ease: easeOut }}
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function PixelArrow() {
  const dots = [[2, 0], [2, 1], [2, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [1, 4], [2, 4], [3, 4], [2, 5]];
  return (
    <svg viewBox="0 0 25 30" className="h-8 w-7" aria-hidden>
      {dots.map(([x, y], k) => (
        <motion.rect key={k} x={x * 5 + 1} y={y * 5 + 1} width={3} height={3} fill="#aebce5"
          initial={{ opacity: 0.15 }} animate={{ opacity: [0.15, 0.7, 0.15] }} transition={{ duration: 1.6, repeat: Infinity, delay: y * 0.12 }} />
      ))}
    </svg>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const consoleY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const consoleScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const fieldY = useTransform(scrollYProgress, [0, 1], [0, 200]);
    const [feed, setFeed] = useState<{ leaf: number; root: string }[]>([]);
  const onInsert = useCallback((leaf: number, root: string) => setFeed((f) => [{ leaf, root }, ...f].slice(0, 4)), []);

  const rise = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay: d, ease: easeOut } });

  return (
    <section ref={ref} className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden pt-[var(--header-h)]">
      {/* Inner bay rails, mirroring the chassis */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 hidden w-[min(1040px,100%)] -translate-x-1/2 border-x border-line md:block xl:hidden">
        <div className="absolute inset-y-0 -left-[49px] w-12 border-x border-line bg-[linear-gradient(180deg,rgba(45,45,82,0.22),rgba(6,6,12,0.1))]" />
        <div className="absolute inset-y-0 -right-[49px] w-12 border-x border-line bg-[linear-gradient(180deg,rgba(45,45,82,0.22),rgba(6,6,12,0.1))]" />
      </div>
      <motion.div className="grid-field absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_50%_45%,black_10%,transparent_65%)]" style={{ y: fieldY }} aria-hidden />
      <motion.div aria-hidden className="absolute inset-x-0 top-[8%] -z-10 mx-auto h-[80%] max-w-[1100px] opacity-[0.28]" style={{ y: fieldY }}>
        <MerkleField scrollProgress={scrollYProgress} onInsert={onInsert} />
      </motion.div>

      <div className="mx-auto grid w-full max-w-[1392px] flex-1 xl:h-[max(640px,calc(100dvh-var(--header-h)-50px))] xl:flex-none xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:border-x xl:border-line">
      <aside aria-label="Pool prices" className="hidden min-h-0 border-r border-line bg-[#0a0a12]/80 xl:block"><PoolRail /></aside>
      <div className="relative flex min-h-[calc(100dvh-var(--header-h)-50px)] flex-col xl:min-h-0">
        <div className="hidden h-11 shrink-0 items-center justify-between border-b border-line px-5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint xl:flex">
          <span>ZKBLAST / Liquidity infrastructure</span><span>Built on Robinhood Chain</span>
        </div>
        <div aria-hidden className="dotmatrix absolute inset-0 top-11 -z-10 hidden xl:block" />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
        <motion.div style={{ y: consoleY, scale: consoleScale }} className="relative w-full max-w-[680px]">
          <div aria-hidden className="grip absolute -left-6 top-0 hidden h-24 sm:block" />
          <div aria-hidden className="grip absolute -right-6 bottom-6 hidden h-24 sm:block" />

          <motion.div {...rise(0.05)} className="panel ticks p-2.5">
            <div className="panel-inset px-4 py-8 text-center sm:px-8 sm:py-10">
              <p className="label mb-6 flex items-center justify-center gap-2"><span className="size-1.5 bg-lime motion-safe:animate-blink" aria-hidden /> Zero-knowledge liquidity · Robinhood Chain</p>
              <h1 className="display">
                <span className="block text-[clamp(1.9rem,4.6vw,2.9rem)] text-fg/55">Provide</span>
                <span className="ticks relative mx-auto my-4 block max-w-[560px] border border-line bg-[linear-gradient(180deg,#14142100,#14142180)] px-4 py-3 font-mono text-[clamp(2.4rem,7vw,4.2rem)] font-normal tracking-[-0.04em] text-white shadow-[inset_0_1px_10px_rgba(0,0,0,0.6),inset_0_0_14px_rgba(255,255,255,0.04)] [--tick-c:rgba(223,227,238,0.6)]">
                  <Drum />
                </span>
                <span className="block text-[clamp(1.9rem,4.6vw,2.9rem)] text-fg/55">Without exposure</span>
              </h1>
            </div>
          </motion.div>

          <div aria-hidden className="flex justify-center gap-24 py-1.5"><span className="barcode w-16" /><span className="barcode w-16" /></div>

          <motion.div {...rise(0.25)} className="panel ticks px-5 py-5 text-center sm:px-8">
            <p className="text-[14px] uppercase leading-relaxed tracking-[0.02em] text-muted sm:text-[15px]">
              Public DLMM and DAMM pools for price discovery, and a shielded vault where a deposit becomes a private note only you can prove you own.
            </p>
          </motion.div>

          <motion.div {...rise(0.45)} className="panel-inset mx-auto mt-3 flex w-fit bg-[#090911] flex-wrap justify-center gap-2 p-2">
            <ButtonLink href="#lanes" variant="secondary">Explore features</ButtonLink>
            <ButtonLink href="/trade">Launch app <ArrowRight className="size-4" aria-hidden /></ButtonLink>
          </motion.div>
        </motion.div>


        <a href="#lanes" aria-label="Scroll to how it works" className="mt-12 opacity-80 transition-opacity hover:opacity-100">
          <PixelArrow />
        </a>
      </div>
      </div>
      <aside aria-label="Event stream" className="hidden min-h-0 border-l border-line bg-[#0a0a12]/80 xl:block"><EventStream commits={feed} /></aside>
      </div>
      <Ticker />
    </section>
  );
}
