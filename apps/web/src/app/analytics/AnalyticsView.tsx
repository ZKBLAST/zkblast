"use client";
import Link from "next/link";
import { useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarChart } from "@/components/charts/BarChart";
import { Delta, LaneBadge, PairMark, SimBadge, TypeTag } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { Segmented } from "@/components/ui/Segmented";
import { activity, feesSeries, summary, tvlSeries, typeSplit, volumeSeries } from "@/data/analytics";
import { pools } from "@/data/pools";
import { vault } from "@/data/shielded";
import { fmtUsd, fmtUsdCompact } from "@/lib/format";

const day = (t: string | number) => new Date(String(t)).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function AnalyticsView() {
  const [range, setRange] = useState<"30" | "90">("90");
  const n = +range;
  const splitTotal = typeSplit.reduce((s, x) => s + x.v, 0);
  const kpis = [
    { label: "Total value locked", value: fmtUsdCompact(summary.tvlUsd), d: summary.tvlChange7d, note: "7d" },
    { label: "Volume 24h", value: fmtUsdCompact(summary.volume24hUsd), d: summary.volumeChange, note: "vs prior day" },
    { label: "Fees 24h", value: fmtUsdCompact(summary.fees24hUsd), d: summary.feesChange, note: "vs prior day" },
    { label: "Swaps 24h", value: summary.swaps24h.toLocaleString("en-US"), d: null, note: `${summary.uniqueTraders24h.toLocaleString("en-US")} traders` },
  ];

  return (
    <>
      <PageHeader title="Analytics" lead="Protocol-wide liquidity, volume and fees for the public pools, plus vault activity on testnet." badges={<SimBadge />}
        aside={<Segmented label="Time range" value={range} onChange={setRange} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />} />

      <div className="mx-auto max-w-[1360px] space-y-6 px-4 sm:px-6">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px border-y border-line bg-line lg:grid-cols-4">
            {kpis.map((k, i) => (
              <div key={k.label} className={`bg-bg py-6 ${i % 2 ? "pl-5" : "pr-5"} ${i > 0 ? "lg:pl-6" : ""}`}>
                <dt className="text-[13px] text-faint">{k.label}</dt>
                <dd className="num mt-2 text-[clamp(1.6rem,3vw,2.4rem)] leading-none">{k.value}</dd>
                <dd className="mt-2 text-[13px] text-faint">{k.d !== null && <Delta v={k.d} />} {k.note}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Reveal className="min-w-0 panel ticks p-5 sm:p-6">
            <div className="flex items-baseline justify-between"><h2 className="wide text-[13.5px]">TVL</h2><LaneBadge lane="public" /></div>
            <div className="mt-5"><AreaChart key={range} data={tvlSeries.slice(-n)} label="Total value locked" format={fmtUsdCompact} formatT={day} height={280} /></div>
          </Reveal>
          <Reveal delay={0.06} className="min-w-0 panel ticks p-5 sm:p-6">
            <h2 className="wide text-[13.5px]">TVL by pool type</h2>
            <div className="mt-6 flex h-4 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={typeSplit.map((t) => `${t.label} ${((t.v / splitTotal) * 100).toFixed(1)}%`).join(", ")}>
              {typeSplit.map((t, i) => <div key={t.label} className={i === 0 ? "bg-lime" : "bg-[#4a5274]"} style={{ width: `${(t.v / splitTotal) * 100}%` }} />)}
            </div>
            <ul className="mt-5 space-y-3">
              {typeSplit.map((t, i) => (
                <li key={t.label} className="flex items-center justify-between text-[14px]">
                  <span className="inline-flex items-center gap-2"><span className={`size-2.5 rounded-[2px] ${i === 0 ? "bg-lime" : "bg-[#4a5274]"}`} aria-hidden />{t.label}</span>
                  <span className="num">{fmtUsdCompact(t.v)} <span className="text-faint">{((t.v / splitTotal) * 100).toFixed(1)}%</span></span>
                </li>
              ))}
            </ul>
            <h3 className="wide mt-8 text-[12.5px]">Shielded vault (testnet)</h3>
            <dl className="mt-3 space-y-2 text-[14px]">
              <div className="flex justify-between"><dt className="text-faint">Commitments</dt><dd className="num">{vault.totalCommitments.toLocaleString("en-US")}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Withdrawals</dt><dd className="num">{vault.spentNullifiers.toLocaleString("en-US")}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Held</dt><dd className="num">{vault.vaultAssets.WETH} WETH · {fmtUsdCompact(vault.vaultAssets.USDC)} USDC</dd></div>
            </dl>
          </Reveal>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal className="min-w-0 panel ticks p-5 sm:p-6">
            <h2 className="wide text-[13.5px]">Daily volume</h2>
            <div className="mt-5"><BarChart key={range} data={volumeSeries.slice(-Math.min(n, 60))} label="Daily volume" format={fmtUsdCompact} formatT={day} height={200} /></div>
          </Reveal>
          <Reveal delay={0.06} className="min-w-0 panel ticks p-5 sm:p-6">
            <h2 className="wide text-[13.5px]">Daily fees to LPs</h2>
            <div className="mt-5"><AreaChart key={range} data={feesSeries.slice(-n)} label="Daily fees" format={fmtUsd} formatT={day} height={200} /></div>
          </Reveal>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Reveal className="min-w-0">
            <h2 className="wide mt-6 text-[13.5px]">Top pools by volume</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[14px]">
                <thead className="border-y border-line font-mono text-[12px] uppercase tracking-wide text-faint">
                  <tr><th scope="col" className="py-3 font-normal">Pool</th><th scope="col" className="py-3 text-right font-normal">Volume 24h</th><th scope="col" className="py-3 text-right font-normal">TVL</th><th scope="col" className="py-3 text-right font-normal">Vol / TVL</th></tr>
                </thead>
                <tbody>
                  {[...pools].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 6).map((p) => (
                    <tr key={p.id} className="border-b border-line transition-colors hover:bg-surface">
                      <td className="py-3"><Link href={`/pools/${p.id}`} className="inline-flex items-center gap-2.5 font-semibold hover:text-lime"><PairMark base={p.base} quote={p.quote} size={22} />{p.base}/{p.quote} <TypeTag type={p.type} /></Link></td>
                      <td className="num py-3 text-right">{fmtUsdCompact(p.volume24hUsd)}</td>
                      <td className="num py-3 text-right">{fmtUsdCompact(p.tvlUsd)}</td>
                      <td className="num py-3 text-right text-muted">{(p.volume24hUsd / p.tvlUsd).toFixed(2)}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
          <Reveal delay={0.06} className="min-w-0">
            <h2 className="wide mt-6 text-[13.5px]">Latest activity</h2>
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {activity.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium">{a.kind}</span>
                    <span className="num text-[12px] text-faint">{a.ago} ago</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] text-muted">{a.summary}</span>
                    <span className={`shrink-0 font-mono text-[11px] uppercase ${a.lane === "shielded" ? "text-lime" : "text-faint"}`}>{a.lane === "shielded" ? "shielded · testnet" : "public"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </>
  );
}
