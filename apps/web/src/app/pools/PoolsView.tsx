"use client";
import { motion, AnimatePresence } from "motion/react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { LaneBadge, PairMark, SimBadge, TypeTag } from "@/components/ui/Badges";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { Segmented } from "@/components/ui/Segmented";
import { pools, priceHistory, type Pool } from "@/data/pools";
import { fmtUsdCompact, cx } from "@/lib/format";

type SortKey = "tvl" | "volume" | "apr";
const sorters: Record<SortKey, (p: Pool) => number> = { tvl: (p) => p.tvlUsd, volume: (p) => p.volume24hUsd, apr: (p) => p.apr };

export function PoolsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const type = (sp.get("type") ?? "all") as "all" | "DLMM" | "DAMM";
  const sort = (sp.get("sort") ?? "tvl") as SortKey;
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const q = sp.get("q") ?? "";

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (v === null || v === "" || (k === "type" && v === "all")) n.delete(k); else n.set(k, v);
    router.replace(`${path}${n.size ? `?${n.toString()}` : ""}`, { scroll: false });
  };
  const toggleSort = (k: SortKey) => {
    if (sort === k) set("dir", dir === "desc" ? "asc" : "desc");
    else { const n = new URLSearchParams(sp.toString()); n.set("sort", k); n.delete("dir"); router.replace(`${path}?${n}`, { scroll: false }); }
  };

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pools
      .filter((p) => (type === "all" || p.type === type) && (!term || `${p.base}/${p.quote} ${p.base} ${p.quote}`.toLowerCase().includes(term)))
      .sort((a, b) => (dir === "desc" ? sorters[sort](b) - sorters[sort](a) : sorters[sort](a) - sorters[sort](b)));
  }, [type, sort, dir, q]);

  const totals = pools.reduce((s, p) => ({ tvl: s.tvl + p.tvlUsd, vol: s.vol + p.volume24hUsd, fees: s.fees + p.fees24hUsd }), { tvl: 0, vol: 0, fees: 0 });

  return (
    <>
      <PageHeader title="Pools" lead="Concentrated DLMM bins for active ranges and DAMM full-range pools with dynamic fees. Pick one to add liquidity."
        badges={<><LaneBadge lane="public" /><SimBadge /></>}
        aside={
          <dl className="grid grid-cols-3 gap-6 md:min-w-[460px]">
            <Stat label="Total TVL" value={fmtUsdCompact(totals.tvl)} />
            <Stat label="Volume 24h" value={fmtUsdCompact(totals.vol)} />
            <Stat label="Fees 24h" value={fmtUsdCompact(totals.fees)} />
          </dl>
        } />

      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <Reveal>
          <div className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
            <Segmented label="Pool type" value={type} onChange={(v) => set("type", v)} options={[{ value: "all", label: "All" }, { value: "DLMM", label: "DLMM" }, { value: "DAMM", label: "DAMM" }]} />
            <label className="relative block sm:w-80">
              <span className="sr-only">Search pools</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <input value={q} onChange={(e) => set("q", e.target.value)} placeholder="Search a token, e.g. WETH…" spellCheck={false}
                className="h-10 w-full rounded-sm border border-line bg-bg pl-10 pr-3 text-[16px] outline-none transition-colors placeholder:text-faint focus:border-lime/70 sm:text-[14px]" />
            </label>
          </div>
        </Reveal>

        <div className="mt-2">
          <div role="row" className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_0.8fr_7rem] gap-4 px-3 py-3 font-mono text-[12px] uppercase tracking-wide text-faint md:grid">
            <span>Pool</span>
            {(["tvl", "volume", "apr"] as SortKey[]).map((k) => (
              <button key={k} onClick={() => toggleSort(k)} aria-sort={sort === k ? (dir === "desc" ? "descending" : "ascending") : "none"} className={cx("inline-flex items-center gap-1 justify-self-end uppercase tracking-wide transition-colors hover:text-fg cursor-pointer", sort === k && "text-fg")}>
                {k === "tvl" ? "TVL" : k === "volume" ? "Volume 24h" : "APR 7d"}
                {sort === k && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
              </button>
            ))}
            <span className="justify-self-end">Fee</span>
            <span className="justify-self-end">7d price</span>
          </div>

          <ul className="border-t border-line md:border-t-0">
            <AnimatePresence initial={false}>
              {list.map((p) => (
                <motion.li key={p.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="border-b border-line">
                  <Link href={`/pools/${p.id}`} className="group grid grid-cols-2 items-center gap-x-4 gap-y-3 rounded-sm px-3 py-4 transition-colors hover:bg-surface md:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_0.8fr_7rem]">
                    <span className="col-span-2 flex items-center gap-3 md:col-span-1">
                      <PairMark base={p.base} quote={p.quote} />
                      <span className="text-[16px] font-semibold transition-colors group-hover:text-lime">{p.base}/{p.quote}</span>
                      <TypeTag type={p.type} />
                      {p.binStep && <span className="font-mono text-[12px] text-faint">step {p.binStep}</span>}
                    </span>
                    <Cell label="TVL" v={fmtUsdCompact(p.tvlUsd)} />
                    <Cell label="Volume 24h" v={fmtUsdCompact(p.volume24hUsd)} />
                    <Cell label="APR 7d" v={<span className="text-lime">{p.apr.toFixed(2)}%</span>} />
                    <Cell label="Fee" v={`${(p.feeBps / 100).toFixed(2)}%`} />
                    <span className="hidden justify-self-end md:block"><Sparkline data={priceHistory(p, 56).map((x) => x.v)} /></span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {list.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-[15px] text-muted">No pool matches “{q}”.</p>
              <button onClick={() => { set("q", null); }} className="mt-3 text-[14px] font-semibold text-lime underline-offset-4 hover:underline cursor-pointer">Clear search</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Cell({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <span className="flex flex-col md:items-end">
      <span className="text-[12px] text-faint md:hidden">{label}</span>
      <span className="num text-[15px]">{v}</span>
    </span>
  );
}
