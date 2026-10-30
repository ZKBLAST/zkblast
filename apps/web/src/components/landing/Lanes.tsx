"use client";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { LaneBadge } from "@/components/ui/Badges";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";

const lanes = [
  {
    id: "pools",
    lane: "public" as const,
    title: "Public lane",
    lead: "DLMM bins and DAMM pools. Every swap, bin and fee is visible onchain, the way an AMM should be when you want price discovery.",
    points: ["Concentrate liquidity in price bins", "Dynamic fees on full-range pools", "Route swaps across both pool types", "Claim fees per position"],
    href: "/trade?mode=liquidity",
    cta: "Browse pools",
  },
  {
    id: "perps",
    lane: "public" as const,
    title: "Perpetuals",
    lead: "Open a USDG-margined long or short from the same trading terminal, with oracle pricing, capped leverage and positions tracked onchain.",
    points: ["PONS, ZKBLAST and WETH markets", "Long or short with controlled leverage", "Live position and activity tracking", "Public or shielded execution"],
    href: "/trade?mode=perps",
    cta: "Trade Perps",
  },
  {
    id: "shielded",
    lane: "shielded" as const,
    title: "Shielded lane",
    lead: "A vault where a deposit becomes a private note. Withdrawing proves you own an unspent note without pointing at which deposit was yours.",
    points: ["Notes created in your browser", "Proofs generated locally", "Nullifiers stop double spends", "Encrypted note backup and restore"],
    href: "/trade?mode=shielded",
    cta: "Open the vault",
  },
];

export function Lanes() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const split = useTransform(scrollYProgress, [0.15, 0.5], ["0%", "100%"]);

  return (
    <section id="lanes" ref={ref} className="mx-auto max-w-[1360px] scroll-mt-24 px-4 pt-32 sm:px-6 md:pt-44">
      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,28rem)] md:items-end">
        <Bay index="02" title="Lanes" className="md:col-span-2" />
        <MaskHeading lines={["One terminal.", "Clear execution."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
        <Reveal>
          <p className="font-mono text-[13.5px] leading-relaxed text-muted">
            A zero-knowledge verifier does not make a public transfer private. So ZKBLAST keeps the lanes apart, labels every action with the lane it runs in, and never puts a privacy mark on a public one.
          </p>
        </Reveal>
      </div>

      <div className="relative mt-16 grid gap-3 lg:grid-cols-3">
        <motion.div aria-hidden className="absolute left-1/3 top-0 z-10 hidden w-px -translate-x-1/2 origin-top bg-lime shadow-[0_0_10px_rgba(223,227,238,0.7)] lg:block" style={{ height: split }} />
        <motion.div aria-hidden className="absolute left-2/3 top-0 z-10 hidden w-px -translate-x-1/2 origin-top bg-lime shadow-[0_0_10px_rgba(223,227,238,0.7)] lg:block" style={{ height: split }} />
        {lanes.map((l, i) => (
          <Reveal key={l.id} delay={i * 0.12} className="panel ticks p-6 pt-10 sm:p-8 sm:pt-12">
            <LaneBadge lane={l.lane} stage={false} />
            <h3 className="wide mt-6 text-[clamp(1.2rem,2vw,1.5rem)]">{l.title}</h3>
            <p className="mt-4 max-w-[34rem] font-mono text-[13.5px] leading-relaxed text-muted">{l.lead}</p>
            <ul className="panel-inset mt-8 divide-y divide-line">
              {l.points.map((p) => (
                <li key={p} className="flex items-center justify-between px-4 py-3 font-mono text-[13px] uppercase tracking-[0.03em]">
                  {p}
                  <span className={l.lane === "shielded" ? "size-1.5 bg-lime" : "size-1.5 bg-muted"} aria-hidden />
                </li>
              ))}
            </ul>
            <Link href={l.href} className="group mt-8 inline-flex items-center gap-2 text-[13px] wide text-fg">
              <span className="border-b border-line-strong pb-0.5 transition-colors group-hover:border-lime">{l.cta}</span>
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
