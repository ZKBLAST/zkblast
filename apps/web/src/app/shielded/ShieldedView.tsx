"use client";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { BackupPanel } from "@/components/shielded/BackupPanel";
import { DepositFlow, type LocalNote } from "@/components/shielded/DepositFlow";
import { ProofSystemPanel, SolvencyPanel, SyncPanel } from "@/components/shielded/StatusPanels";
import { WithdrawFlow } from "@/components/shielded/WithdrawFlow";
import { LaneBadge, SimBadge, TokenMark } from "@/components/ui/Badges";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { Segmented } from "@/components/ui/Segmented";
import { shieldedDepositsSeries } from "@/data/analytics";
import { notes as seedNotes, privacyBoundaries, vault } from "@/data/shielded";
import { fmtAmount, cx } from "@/lib/format";

type Tab = "deposit" | "withdraw" | "backup";
const STORE = "zkblast:testnet-notes";

export function ShieldedView() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = (["deposit", "withdraw", "backup"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "deposit") as Tab;
  const setTab = (t: Tab) => router.replace(`${path}?tab=${t}`, { scroll: false });
  const [notes, setNotes] = useState<LocalNote[]>(seedNotes);
  const [loaded, setLoaded] = useState(false);

  // Testnet demo notes persist in this browser only.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORE);
      if (stored) setNotes(JSON.parse(stored) as LocalNote[]);
    } catch {
      localStorage.removeItem(STORE);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(notes));
    } catch {
      // Storage may be unavailable in private browsing; notes remain in memory.
    }
  }, [notes, loaded]);

  const leaves = vault.totalCommitments + notes.filter((n) => !seedNotes.find((s) => s.id === n.id)).length;
  const unspent = notes.filter((n) => n.status === "unspent");

  return (
    <>
      <PageHeader title="Shielded vault" lead="Deposit a fixed amount, keep a private note, and later withdraw to any address by proving you own an unspent note."
        badges={<><LaneBadge lane="shielded" /><SimBadge /></>}
        aside={
          <dl className="grid grid-cols-3 gap-6 md:min-w-[460px]">
            <Stat label="Commitments" value={leaves.toLocaleString("en-US")} />
            <Stat label="Nullifiers spent" value={vault.spentNullifiers.toLocaleString("en-US")} />
            <Stat label="Your unspent" value={unspent.length} />
          </dl>
        } />

      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <Reveal>
          <div role="note" className="flex items-start gap-3 rounded-md border border-warn/50 bg-warn/[0.05] px-4 py-3.5 text-[14px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <p className="text-muted"><span className="font-semibold text-warn">Testnet preview, unaudited.</span> The withdraw-v1 verifier is deployed and verified, but the custody vault is not deployed yet. Deposit, note, proof-progress, root, and withdrawal controls on this page remain local simulations and cannot move funds.</p>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Reveal className="min-w-0">
            <div className="panel ticks">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <Segmented label="Vault action" value={tab} onChange={setTab} options={[{ value: "deposit", label: "Deposit" }, { value: "withdraw", label: "Withdraw" }, { value: "backup", label: "Backup" }]} />
                <LaneBadge lane="shielded" />
              </div>
              <div className="p-5 sm:p-7">
                {tab === "deposit" && <DepositFlow nextLeaf={leaves} onCreated={(n) => setNotes((x) => [n, ...x])} />}
                {tab === "withdraw" && <WithdrawFlow notes={notes} onSpent={(id) => setNotes((x) => x.map((n) => (n.id === id ? { ...n, status: "spent" } : n)))} />}
                {tab === "backup" && <BackupPanel notes={notes} onRestore={(r) => setNotes((x) => [...r.filter((n) => !x.some((y) => y.id === n.id)), ...x])} />}
              </div>
            </div>
          </Reveal>
          <div className="space-y-4">
            <Reveal delay={0.05}><SyncPanel leaves={leaves} /></Reveal>
            <Reveal delay={0.1}><ProofSystemPanel /></Reveal>
            <Reveal delay={0.15}><SolvencyPanel /></Reveal>
          </div>
        </div>

        <Reveal>
          <h2 className="display mt-20 text-[clamp(1.8rem,3.6vw,2.8rem)]">Notes on this device</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="border-y border-line font-mono text-[12px] uppercase tracking-wide text-faint">
                <tr><th scope="col" className="py-3 font-normal">Asset</th><th scope="col" className="py-3 font-normal">Leaf</th><th scope="col" className="py-3 font-normal">Commitment</th><th scope="col" className="py-3 font-normal">Created</th><th scope="col" className="py-3 font-normal">Backup</th><th scope="col" className="py-3 text-right font-normal">Status</th></tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id} className="border-b border-line">
                    <td className="py-3.5"><span className="inline-flex items-center gap-2"><TokenMark symbol={n.asset} size={22} /><span className="num">{fmtAmount(n.amount)} {n.asset}</span></span></td>
                    <td className="num py-3.5 text-muted">#{n.leafIndex.toLocaleString("en-US")}</td>
                    <td className="num py-3.5 text-muted">{n.commitment}</td>
                    <td className="py-3.5 text-muted">{new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td className={cx("py-3.5", n.backedUp ? "text-muted" : "text-warn")}>{n.backedUp ? "Encrypted file" : "Not backed up"}</td>
                    <td className="py-3.5 text-right"><span className={cx("font-mono text-[12px] uppercase", n.status === "unspent" ? "text-lime" : "text-faint")}>{n.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {notes.some((n) => !n.backedUp && n.status === "unspent") && (
            <p className="mt-3 text-[13px] text-warn">One or more unspent notes have no backup. <button onClick={() => setTab("backup")} className="font-semibold underline underline-offset-4 cursor-pointer">Export a backup now</button>.</p>
          )}
        </Reveal>

        <div className="mt-20 grid gap-10 lg:grid-cols-2">
          <Reveal>
            <h2 className="display text-[clamp(1.8rem,3.6vw,2.8rem)]">Privacy boundaries</h2>
            <p className="mt-3 text-[15px] text-muted">The vault hides one thing: which deposit paid for which withdrawal. Everything below in the left column stays visible to anyone reading the chain.</p>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {privacyBoundaries.map((r) => (
                <li key={r.item} className="flex items-baseline justify-between gap-4 py-3 text-[14px]">
                  <span>{r.item}</span>
                  <span className={cx("shrink-0 text-right font-mono text-[12px]", r.shielded.startsWith("Visible") ? "text-muted" : r.shielded.startsWith("Not") ? "text-faint" : "text-lime")}>{r.shielded}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-faint">Metadata can still leak through your IP to the RPC, wallet fingerprinting, gas payment and timing. Use a fresh recipient and wait before withdrawing.</p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="display text-[clamp(1.8rem,3.6vw,2.8rem)]">Deposits, 30 days</h2>
            <p className="mt-3 text-[15px] text-muted">Daily new commitments across both assets. Simulated testnet activity.</p>
            <div className="mt-6 panel ticks p-5">
              <BarChart data={shieldedDepositsSeries} label="Daily shielded deposits" format={(v) => `${v} deposits`} formatT={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })} height={220} />
            </div>
          </Reveal>
        </div>
      </div>
    </>
  );
}
