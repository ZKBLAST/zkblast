"use client";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bay } from "@/components/ui/Frame";
import { PairMark, TypeTag } from "@/components/ui/Badges";
import { MaskHeading } from "@/components/ui/Reveal";
import { pools, priceHistory, seeded, type Pool } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";
import { cx, fmtPrice, fmtUsdCompact } from "@/lib/format";

type SortKey = "tvl" | "volume" | "apr" | "change";
const PER_PAGE = 6;

function AreaSpark({ data, up }: { data: number[]; up: boolean }) {
  const id = useId();
  const w = 112, h = 34;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const c = up ? "#3EE58E" : "#ff6b5e";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.28" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

const change = (p: Pool) => tokenBySymbol(p.base).change24h - (p.quote.startsWith("USD") || p.quote === "DAI" ? 0 : tokenBySymbol(p.quote).change24h);

export function MarketsTable() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [type, setType] = useState<"all" | "DLMM" | "DAMM">("all");
  const [sort, setSort] = useState<SortKey>("tvl");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const [fav, setFav] = useState<Set<string>>(() => new Set(["weth-usdc-dlmm-10"]));
  const [tick, setTick] = useState(0);

  // Small price drift so the board reads as a live feed.
  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setTick((t) => t + 1), 1600);
    return () => clearInterval(id);
  }, [inView, reduce]);

  const rows = useMemo(() => {
    const sorters: Record<SortKey, (p: Pool) => number> = { tvl: (p) => p.tvlUsd, volume: (p) => p.volume24hUsd, apr: (p) => p.apr, change };
    return pools
      .filter((p) => type === "all" || p.type === type)
      .sort((a, b) => (dir === "desc" ? sorters[sort](b) - sorters[sort](a) : sorters[sort](a) - sorters[sort](b)));
  }, [type, sort, dir]);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const view = rows.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const hist = useMemo(() => Object.fromEntries(pools.map((p) => [p.id, priceHistory(p, 48).map((x) => x.v)])), []);
  const drift = (p: Pool) => {
    const r = seeded(tick * 131 + (p.tvlUsd % 997) + p.feeBps);
    return 1 + (r() - 0.5) * 0.0012;
  };
  const flashing = useMemo(() => {
    const r = seeded(tick + 77);
    return new Set([pools[(r() * pools.length) | 0].id, pools[(r() * pools.length) | 0].id]);
  }, [tick]);

  const totals = pools.reduce((s, p) => ({ tvl: s.tvl + p.tvlUsd, vol: s.vol + p.volume24hUsd, fees: s.fees + p.fees24hUsd }), { tvl: 0, vol: 0, fees: 0 });

  const head = (k: SortKey, label: string) => (
    <button onClick={() => { if (sort === k) setDir(dir === "desc" ? "asc" : "desc"); else { setSort(k); setDir("desc"); } setPage(0); }}
      aria-sort={sort === k ? (dir === "desc" ? "descending" : "ascending") : "none"}
      className={cx("inline-flex items-center gap-1 justify-self-end uppercase tracking-[0.12em] transition-colors hover:text-fg cursor-pointer", sort === k && "text-fg")}>
      {label}{sort === k && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
    </button>
  );

  const cols = "lg:grid-cols-[28px_minmax(0,2.1fr)_1.05fr_0.8fr_0.95fr_0.95fr_0.75fr_0.6fr_120px_76px]";

  return (
    <section ref={ref} aria-label="Markets" className="mx-auto max-w-[1392px] px-3 pt-24 sm:px-4 md:pt-32">
      <div className="px-1 sm:px-3">
        <Bay index="01" title="Markets" />
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <MaskHeading lines={["Every pool.", "One board."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
          <dl className="grid grid-cols-3 gap-6 md:gap-10">
            {[["Total TVL", fmtUsdCompact(totals.tvl)], ["Volume 24h", fmtUsdCompact(totals.vol)], ["Fees 24h", fmtUsdCompact(totals.fees)]].map(([l, v]) => (
              <div key={l}><dt className="label">{l}</dt><dd className="num mt-1 text-[20px] text-fg sm:text-[24px]">{v}</dd></div>
            ))}
          </dl>
        </div>
      </div>

      <div className="panel ticks mt-10 p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 pb-3">
          <div role="tablist" aria-label="Pool type" className="panel-inset flex p-1">
            {(["all", "DLMM", "DAMM"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={type === t} onClick={() => { setType(t); setPage(0); }}
                className={cx("relative h-8 px-4 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors cursor-pointer", type === t ? "text-lime-ink" : "text-muted hover:text-fg")}>
                {type === t && <motion.span layoutId="mk-tab" className="absolute inset-0 bg-lime" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                <span className="relative">{t === "all" ? "All pools" : t}</span>
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
            <span className="size-1.5 rounded-full bg-lime motion-safe:animate-pulse" aria-hidden />{rows.length} markets · live
          </span>
        </div>

        <div className="panel-inset">
          <div role="row" className={cx("hidden items-center gap-4 border-b border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-faint lg:grid", cols)}>
            <span />
            <span>Market</span>
            <span className="justify-self-end">Price</span>
            {head("change", "24h")}
            {head("tvl", "TVL")}
            {head("volume", "Volume 24h")}
            {head("apr", "APR")}
            <span className="justify-self-end">Fee</span>
            <span className="justify-self-end">7d</span>
            <span />
          </div>

          <ul>
            <AnimatePresence mode="popLayout" initial={false}>
              {view.map((p, i) => {
                const ch = change(p);
                const up = ch >= 0;
                const price = p.price * drift(p);
                return (
                  <motion.li key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, delay: i * 0.03 }}
                    className="group border-b border-line last:border-0">
                    <div className={cx("grid grid-cols-[28px_1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-4 transition-colors hover:bg-white/[0.02] lg:min-h-[72px] lg:py-0", cols)}>
                      <button onClick={() => setFav((f) => { const n = new Set(f); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                        aria-label={fav.has(p.id) ? `Unstar ${p.base}/${p.quote}` : `Star ${p.base}/${p.quote}`} aria-pressed={fav.has(p.id)}
                        className="grid size-7 place-items-center text-faint transition-colors hover:text-lime cursor-pointer">
                        <Star className={cx("size-3.5", fav.has(p.id) && "fill-lime text-lime")} />
                      </button>
                      <Link href={`/pools/${p.id}`} className="flex min-w-0 items-center gap-3">
                        <PairMark base={p.base} quote={p.quote} size={26} />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[13.5px] text-fg transition-colors group-hover:text-lime">{p.base}/{p.quote}</span>
                          <span className="mt-0.5 flex items-center gap-2"><TypeTag type={p.type} />{p.binStep && <span className="font-mono text-[10.5px] text-faint">bin {p.binStep}bps</span>}</span>
                        </span>
                      </Link>
                      <span className={cx("num justify-self-end text-[13.5px] transition-colors duration-500", flashing.has(p.id) ? (up ? "text-up" : "text-danger") : "text-fg")}>{fmtPrice(price)}</span>
                      <span className="col-span-2 col-start-2 flex gap-4 font-mono text-[11px] text-faint lg:hidden">
                        <span className={up ? "text-up" : "text-danger"}>{up ? "+" : ""}{ch.toFixed(2)}%</span>
                        <span>TVL {fmtUsdCompact(p.tvlUsd)}</span>
                        <span>APR <span className="text-lime">{p.apr.toFixed(2)}%</span></span>
                      </span>
                      <span className={cx("num hidden justify-self-end text-[12.5px] lg:block", up ? "text-up" : "text-danger")}>{up ? "+" : ""}{ch.toFixed(2)}%</span>
                      <Cell label="TVL" v={fmtUsdCompact(p.tvlUsd)} />
                      <Cell label="Vol 24h" v={fmtUsdCompact(p.volume24hUsd)} />
                      <Cell label="APR" v={<span className="text-lime">{p.apr.toFixed(2)}%</span>} />
                      <Cell label="Fee" v={`${(p.feeBps / 100).toFixed(2)}%`} />
                      <span className="hidden justify-self-end lg:block"><AreaSpark data={hist[p.id]} up={up} /></span>
                      <Link href={`/pools/${p.id}`} className="hidden items-center gap-1 justify-self-end border border-line-strong px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted transition-colors hover:border-lime/60 hover:text-lime lg:inline-flex">
                        Trade <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 pt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
          <Link href="/pools" className="inline-flex items-center gap-1.5 text-fg/85 transition-colors hover:text-lime">View all pools <ArrowUpRight className="size-3.5" aria-hidden /></Link>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((v) => Math.max(0, v - 1))} disabled={page === 0} aria-label="Previous page" className="grid size-8 place-items-center border border-line text-muted transition-colors hover:text-fg disabled:opacity-35 cursor-pointer"><ChevronLeft className="size-4" /></button>
            <span className="num w-14 text-center text-fg/85">{page + 1} / {pages}</span>
            <button onClick={() => setPage((v) => Math.min(pages - 1, v + 1))} disabled={page >= pages - 1} aria-label="Next page" className="grid size-8 place-items-center border border-line text-muted transition-colors hover:text-fg disabled:opacity-35 cursor-pointer"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Cell({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <span className="col-span-1 hidden flex-col justify-self-end lg:flex">
      <span className="sr-only">{label}</span>
      <span className="num text-[13px] text-fg/90">{v}</span>
    </span>
  );
}
