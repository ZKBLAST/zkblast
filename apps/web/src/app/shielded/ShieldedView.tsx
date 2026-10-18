"use client";
import { ShieldAlert } from "lucide-react";
import { LaneBadge } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";

export function ShieldedView() {
  return <><PageHeader title="Shielded vault" lead="The proof verifier is deployed, but a custody vault with real deposits is not yet available on this testnet environment." badges={<LaneBadge lane="shielded" />} /><div className="mx-auto max-w-[1360px] px-4 sm:px-6"><section className="panel ticks flex items-start gap-4 p-8"><ShieldAlert className="size-6 shrink-0 text-warn" aria-hidden /><div><h2 className="wide text-base">No on-chain vault data available</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Deposit, withdrawal, note, anonymity-set, solvency, and proof-progress controls are disabled until the custody vault is deployed and indexed. ZKBLAST will not simulate balances or create local notes that could be mistaken for real assets.</p></div></section></div></>;
}
