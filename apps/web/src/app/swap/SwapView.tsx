"use client";
import { useCallback, useMemo, useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { Delta, PairMark, SimBadge, TypeTag } from "@/components/ui/Badges";
import { Reveal } from "@/components/ui/Reveal";
import { Segmented } from "@/components/ui/Segmented";
import { SwapCard } from "@/components/swap/SwapCard";
import { activity } from "@/data/analytics";
import { pools, priceHistory } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";
import { fmtPrice, fmtUsdCompact } from "@/lib/format";

export function SwapView() {
  const [pair, setPair] = useState<[string, string]>(["WETH", "USDC"]);
  const [range, setRange] = useState<"24H" | "7D" | "30D">("7D");
  const onPair = useCallback((a: string, b: string) => setPair([a, b]), []);
  const pool = useMemo(() => pools.find((p) => (p.base === pair[0] && p.quote === pair[1]) || (p.base === pair[1] && p.quote === pair[0])) ?? pools[0], [pair]);
  const hist = useMemo(() => {
    const h = priceHistory(pool, 96);
    const n = range === "24H" ? 24 : range === "7D" ? 56 : 96;
    return h.slice(-n);
  }, [pool, range]);
  const change = ((hist[hist.length - 1].v - hist[0].v) / hist[0].v) * 100;

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-10 pt-[calc(var(--header-h)+2rem)] sm:px-6 md:pt-[calc(var(--header-h)+3rem)]">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-10">
        <div className="order-2 min-w-0 lg:order-1">
          <Reveal>
            <div className="flex flex-wrap items-center gap-3">
              <PairMark base={pool.base} quote={pool.quote} size={32} />
              <h1 className="display text-[clamp(2rem,4.5vw,3.4rem)]">{pool.base}/{pool.quote}</h1>
              <TypeTag type={pool.type} />
              <SimBadge />
            </div>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="num text-[34px] leading-none">{fmtPrice(pool.price)} <span className="text-[15px] text-faint">{pool.quote}</span></p>
                <p className="mt-2"><Delta v={change} /> <span className="text-[13px] text-faint">over {range}</span></p>
              </div>
              <Segmented label="Chart range" size="sm" value={range} onChange={setRange} options={[{ value: "24H", label: "24H" }, { value: "7D", label: "7D" }, { value: "30D", label: "30D" }]} />
            </div>
            <div className="mt-6 panel ticks p-3 sm:p-5">
              <AreaChart data={hist} label={`${pool.base}/${pool.quote} price`} format={(v) => `${fmtPrice(v)} ${pool.quote}`} formatT={(t) => { const h = hist[hist.length - 1].t - Number(t); return h === 0 ? "now" : `${h}h ago`; }} height={260} />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-4">
              {[["TVL", fmtUsdCompact(pool.tvlUsd)], ["Volume 24h", fmtUsdCompact(pool.volume24hUsd)], ["Fee tier", `${(pool.feeBps / 100).toFixed(2)}%`], [`${pool.base} 24h`, `${tokenBySymbol(pool.base).change24h > 0 ? "+" : ""}${tokenBySymbol(pool.base).change24h}%`]].map(([k, v]) => (
                <div key={k}><dt className="text-[13px] text-faint">{k}</dt><dd className="num mt-1 text-[20px]">{v}</dd></div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={0.1}>
            <h2 className="wide mt-12 text-[13.5px]">Recent activity</h2>
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {activity.filter((a) => a.lane === "public").map((a) => (
                <li key={a.id} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-4 py-3.5 text-[14px]">
                  <span className="font-mono text-[12px] text-faint">{a.kind}</span>
                  <span className="truncate">{a.summary}</span>
                  <span className="num text-[12px] text-faint">{a.ago} ago</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <div className="order-1 min-w-0 lg:order-2">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
            <Reveal y={20}>
              <SwapCard onPair={onPair} />
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
