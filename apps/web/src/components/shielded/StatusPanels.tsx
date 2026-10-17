"use client";
import { motion } from "motion/react";
import { Check, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { sync as seed, vault } from "@/data/shielded";
import { fmtAmount, cx } from "@/lib/format";

export function SyncPanel({ leaves }: { leaves: number }) {
  const [syncing, setSyncing] = useState(false);
  const [at, setAt] = useState("just now");
  const rows = [["This device", seed.localRoot], ["Indexer", seed.indexerRoot], ["Chain (accepted)", seed.chainRoot]];
  const matched = rows.every((r) => r[1] === seed.chainRoot);
  const resync = () => { setSyncing(true); setTimeout(() => { setSyncing(false); setAt("just now"); }, 1400); };
  return (
    <section className="panel ticks p-5" aria-labelledby="sync-h">
      <div className="flex items-center justify-between">
        <h2 id="sync-h" className="wide text-[13.5px]">Root sync</h2>
        <button onClick={resync} disabled={syncing} className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-60 cursor-pointer">
          <RefreshCw className={cx("size-3.5", syncing && "animate-spin")} aria-hidden /> {syncing ? "Syncing…" : "Resync"}
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map(([k, v], i) => (
          <li key={k} className="relative flex items-center justify-between overflow-hidden rounded-sm bg-bg px-3 py-2 text-[13px]">
            {syncing && <motion.span className="absolute inset-y-0 left-0 w-1/3 bg-lime/10" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 0.9, delay: i * 0.12, repeat: Infinity }} />}
            <span className="relative text-faint">{k}</span>
            <span className="num relative">{v}</span>
          </li>
        ))}
      </ul>
      <p className={cx("mt-3 flex items-center gap-1.5 text-[13px]", matched ? "text-lime" : "text-danger")}>
        {matched ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
        {matched ? "Roots match. Proofs will use an accepted root." : "Roots differ. Wait for the indexer before proving."}
      </p>
      <p className="num mt-1 text-[12px] text-faint">{leaves.toLocaleString("en-US")} leaves · lag {seed.lagBlocks} blocks · synced {at}</p>
    </section>
  );
}

export function ProofSystemPanel() {
  return (
    <section className="panel ticks p-5" aria-labelledby="proof-h">
      <h2 id="proof-h" className="wide text-[13.5px]">Proof system</h2>
      <dl className="mt-3 space-y-2 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-faint">Circuit</dt><dd className="num">{vault.circuit.id} · {vault.circuit.version}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-faint">Backend</dt><dd className="text-right">{vault.circuit.backend}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-faint">Verifier key</dt><dd className="text-warn">Not published</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-faint">Tree depth</dt><dd className="num">{vault.treeDepth} · {vault.rootHistory} roots kept</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-faint">Proving</dt><dd>In your browser</dd></div>
      </dl>
      <p className="mt-3 text-[12px] text-faint">Proofs in this demo are simulated. No verifier is deployed, so nothing here is verified onchain.</p>
    </section>
  );
}

export function SolvencyPanel() {
  return (
    <section className="panel ticks p-5" aria-labelledby="solv-h">
      <h2 id="solv-h" className="wide text-[13.5px]">Vault solvency</h2>
      <ul className="mt-3 space-y-3">
        {vault.allowlist.map((a) => {
          const assets = vault.vaultAssets[a], liab = vault.vaultLiabilities[a];
          const ok = liab <= assets;
          return (
            <li key={a}>
              <div className="flex justify-between text-[13px]"><span className="text-faint">{a}</span><span className={ok ? "text-lime" : "text-danger"}>{ok ? "liabilities ≤ assets" : "deficit"}</span></div>
              <div className="num mt-1 flex justify-between text-[13px]"><span>{fmtAmount(liab)} owed</span><span>{fmtAmount(assets)} held</span></div>
              <div className="mt-1.5 h-1.5 rounded-full bg-line"><motion.div className="h-1.5 rounded-full bg-lime" initial={{ width: 0 }} whileInView={{ width: `${Math.min(100, (liab / assets) * 100)}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} /></div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-faint">Simulated values. The invariant is checked on every deposit and withdrawal in the contract tests.</p>
    </section>
  );
}
