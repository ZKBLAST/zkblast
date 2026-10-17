"use client";
import { AnimatePresence, motion } from "motion/react";
import { Layers } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { AccountPanel } from "@/components/account/AccountPanel";
import { LaneBadge, PairMark, SimBadge, TypeTag } from "@/components/ui/Badges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { TxSteps, type StepState } from "@/components/swap/TxSteps";
import { poolById } from "@/data/pools";
import { positions as seed, type Position } from "@/data/positions";
import { fmtAmount, fmtUsd, cx } from "@/lib/format";

type Action = { kind: "claim" | "remove"; pos: Position } | null;

export function PositionsView() {
  const { address, connect, toast } = useApp();
  const [list, setList] = useState(seed);
  const [action, setAction] = useState<Action>(null);
  const [pct, setPct] = useState(100);
  const [stage, setStage] = useState<number | null>(null);

  const totals = list.reduce((s, p) => ({ value: s.value + p.valueUsd, dep: s.dep + p.depositedUsd, fees: s.fees + p.unclaimedFeesUsd }), { value: 0, dep: 0, fees: 0 });
  const pnl = totals.value - totals.dep;

  const run = () => {
    if (!action) return;
    setStage(0);
    setTimeout(() => setStage(1), 1100);
    setTimeout(() => {
      setStage(2);
      const id = action.pos.id;
      if (action.kind === "claim") {
        toast({ kind: "success", title: `Claimed ${fmtUsd(action.pos.unclaimedFeesUsd)} in fees`, body: "Simulated transaction" });
        setList((l) => l.map((p) => (p.id === id ? { ...p, unclaimedFeesUsd: 0, unclaimedBase: 0, unclaimedQuote: 0 } : p)));
      } else {
        toast({ kind: "success", title: `Removed ${pct}% of liquidity`, body: "Simulated transaction" });
        setList((l) => (pct === 100 ? l.filter((p) => p.id !== id) : l.map((p) => (p.id === id ? { ...p, valueUsd: p.valueUsd * (1 - pct / 100), depositedUsd: p.depositedUsd * (1 - pct / 100), baseAmount: p.baseAmount * (1 - pct / 100), quoteAmount: p.quoteAmount * (1 - pct / 100), unclaimedFeesUsd: 0 } : p))));
      }
    }, 2400);
  };
  const close = () => { setAction(null); setStage(null); setPct(100); };
  const st = (i: number): StepState => (stage === null ? "idle" : stage > i ? "done" : stage === i ? "active" : "idle");

  if (!address) {
    return (
      <>
        <PageHeader title="Positions" lead="Your liquidity across DLMM and DAMM pools, with range status and claimable fees." badges={<><LaneBadge lane="public" /><SimBadge /></>} />
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
          <Reveal className="flex flex-col items-start gap-5 rounded-lg border border-dashed border-line-strong p-8 sm:p-12">
            <Layers className="size-6 text-muted" aria-hidden />
            <div>
              <p className="wide text-[15px]">Connect a wallet to see your positions</p>
              <p className="mt-2 max-w-md text-[15px] text-muted">The demo account already has four positions, including one out of range, so you can try claiming and removing.</p>
            </div>
            <Button size="lg" onClick={connect}>Connect wallet</Button>
          </Reveal>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Positions" lead="Your liquidity across DLMM and DAMM pools, with range status and claimable fees." badges={<><LaneBadge lane="public" /><SimBadge /></>}
        aside={
          <dl className="grid grid-cols-3 gap-6 md:min-w-[460px]">
            <Stat label="Value" value={fmtUsd(totals.value)} />
            <Stat label="PnL" value={<span className={pnl >= 0 ? "text-up" : "text-danger"}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}</span>} />
            <Stat label="Unclaimed fees" value={fmtUsd(totals.fees)} />
          </dl>
        } />

      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <AccountPanel />
        {list.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-strong p-10 text-center">
            <p className="text-[15px] text-muted">No open positions.</p>
            <ButtonLink href="/pools" className="mt-4">Find a pool</ButtonLink>
          </div>
        )}
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {list.map((p, i) => {
              const pool = poolById(p.poolId)!;
              const inRange = pool.type === "DAMM" || (p.lowerBinOffset! <= 0 && p.upperBinOffset! >= 0);
              return (
                <motion.li key={p.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }} exit={{ opacity: 0, x: -40, transition: { duration: 0.25 } }}
                  className="panel ticks p-5 sm:p-6">
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex items-center gap-3">
                      <PairMark base={pool.base} quote={pool.quote} size={32} />
                      <div>
                        <Link href={`/pools/${pool.id}`} className="text-[17px] font-semibold hover:text-lime">{pool.base}/{pool.quote}</Link>
                        <div className="mt-1 flex items-center gap-2"><TypeTag type={pool.type} />{p.shape && <span className="font-mono text-[12px] text-faint">{p.shape}</span>}<span className="font-mono text-[12px] text-faint">{p.openedDaysAgo}d</span></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[13px]">
                        <span className={cx("inline-flex items-center gap-1.5 font-medium", inRange ? "text-lime" : "text-warn")}>
                          <span className={cx("size-1.5 rounded-full", inRange ? "bg-lime" : "bg-warn")} aria-hidden />
                          {inRange ? "In range, earning fees" : "Out of range, not earning"}
                        </span>
                        {pool.type === "DLMM" && <span className="num text-faint">bins {p.lowerBinOffset} to +{p.upperBinOffset}</span>}
                      </div>
                      {pool.type === "DLMM" ? <RangeBar lo={p.lowerBinOffset!} hi={p.upperBinOffset!} /> : <div className="mt-3 h-2 rounded-full bg-[#2e3550]" aria-label="Full range" />}
                    </div>

                    <dl className="grid grid-cols-2 gap-4">
                      <div><dt className="text-[12px] text-faint">Value</dt><dd className="num text-[16px]">{fmtUsd(p.valueUsd)}</dd><dd className="num text-[12px] text-faint">{fmtAmount(p.baseAmount)} {pool.base} · {fmtAmount(p.quoteAmount)} {pool.quote}</dd></div>
                      <div><dt className="text-[12px] text-faint">Fees</dt><dd className="num text-[16px] text-lime">{fmtUsd(p.unclaimedFeesUsd)}</dd></div>
                    </dl>

                    <div className="flex gap-2 lg:flex-col xl:flex-row">
                      <Button size="sm" disabled={p.unclaimedFeesUsd <= 0} onClick={() => setAction({ kind: "claim", pos: p })}>Claim</Button>
                      <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "remove", pos: p })}>Remove</Button>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      <Modal open={!!action} onClose={close} title={action?.kind === "claim" ? "Claim fees" : "Remove liquidity"} dismissible={stage === null || stage === 2}>
        {action && (() => {
          const pool = poolById(action.pos.poolId)!;
          return stage === null ? (
            action.kind === "claim" ? (
              <>
                <dl className="space-y-2 text-[15px]">
                  <div className="flex justify-between"><dt className="text-faint">{pool.base}</dt><dd className="num">{fmtAmount(action.pos.unclaimedBase)}</dd></div>
                  <div className="flex justify-between"><dt className="text-faint">{pool.quote}</dt><dd className="num">{fmtAmount(action.pos.unclaimedQuote)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-faint">Total</dt><dd className="num text-lime">{fmtUsd(action.pos.unclaimedFeesUsd)}</dd></div>
                </dl>
                <Button size="lg" className="mt-6 w-full" onClick={run}>Claim {fmtUsd(action.pos.unclaimedFeesUsd)}</Button>
              </>
            ) : (
              <>
                <p className="num display text-[56px] leading-none">{pct}%</p>
                <label className="mt-4 block">
                  <span className="sr-only">Percent to remove</span>
                  <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(+e.target.value)} className="w-full accent-[#dfe3ee]" />
                </label>
                <div className="mt-3 flex gap-2">
                  {[25, 50, 75, 100].map((v) => (
                    <button key={v} onClick={() => setPct(v)} aria-pressed={pct === v} className={cx("num h-10 flex-1 rounded-sm border text-[13px] transition-colors cursor-pointer", pct === v ? "border-lime text-lime" : "border-line hover:border-line-strong")}>{v === 100 ? "Max" : `${v}%`}</button>
                  ))}
                </div>
                <dl className="mt-5 space-y-2 border-t border-line pt-4 text-[14px]">
                  <div className="flex justify-between"><dt className="text-faint">You receive</dt><dd className="num">{fmtAmount((action.pos.baseAmount * pct) / 100)} {pool.base} + {fmtAmount((action.pos.quoteAmount * pct) / 100)} {pool.quote}</dd></div>
                  <div className="flex justify-between"><dt className="text-faint">Fees claimed too</dt><dd className="num text-lime">{fmtUsd(action.pos.unclaimedFeesUsd)}</dd></div>
                </dl>
                <Button size="lg" className="mt-6 w-full" onClick={run}>Remove {pct}%</Button>
              </>
            )
          ) : (
            <>
              <TxSteps steps={[
                { label: "Sign in wallet", detail: "Simulated signature", state: st(0) },
                { label: "Confirming", detail: stage >= 1 ? "Simulated block" : undefined, state: st(1) },
                { label: "Done", state: stage >= 2 ? "done" : "idle" },
              ]} />
              {stage === 2 && <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={close}>Close</Button>}
            </>
          );
        })()}
      </Modal>
    </>
  );
}

function RangeBar({ lo, hi }: { lo: number; hi: number }) {
  const R = 34;
  const pos = (o: number) => `${((o + R) / (2 * R)) * 100}%`;
  return (
    <div className="relative mt-3 h-2 rounded-full bg-line" aria-hidden>
      <motion.div className="absolute inset-y-0 rounded-full bg-[#2e3550]" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
      <span className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-full bg-lime" style={{ left: pos(0) }} />
    </div>
  );
}
