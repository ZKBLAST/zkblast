"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { BackupPanel } from "@/components/shielded/BackupPanel";
import { DepositFlow } from "@/components/shielded/DepositFlow";
import { WithdrawFlow } from "@/components/shielded/WithdrawFlow";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";
import { executeShieldedDeposit } from "@/lib/shielded-deposit";
import type { ShieldedNoteV1 } from "@/lib/notecrypto";

export function ShieldedView() {
  const { address, config } = useApp();
  const [notes, setNotes] = useState<readonly ShieldedNoteV1[]>([]);
  const shielded = config?.shielded;

  if (!config || !shielded) {
    return (
      <>
        <PageHeader
          title="Shielded vault"
          lead="The custody vault is not available for the active network."
          badges={<LaneBadge lane="shielded" />}
        />
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
          <section className="panel ticks flex items-start gap-4 p-8">
            <ShieldAlert className="size-6 shrink-0 text-warn" aria-hidden />
            <div>
              <h2 className="wide text-base">
                No validated on-chain vault configuration
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                Controls remain disabled until the API publishes a
                deployment-manifest-backed vault for this chain.
              </p>
            </div>
          </section>
        </div>
      </>
    );
  }

  const submit = async (note: ShieldedNoteV1) => {
    if (!window.ethereum || !address) throw new Error("WALLET_NOT_CONNECTED");
    return executeShieldedDeposit(
      window.ethereum,
      address as `0x${string}`,
      note,
      () => undefined,
    );
  };

  return (
    <>
      <PageHeader
        title="Shielded vault"
        lead="Create the note locally, save an encrypted backup, then deposit the exact governance-approved denomination."
        badges={<LaneBadge lane="shielded" />}
      />
      <div className="mx-auto grid max-w-[1360px] gap-6 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel ticks p-6">
          <DepositFlow
            environment={config.environment}
            chainId={config.chainId}
            vaultAddress={shielded.vaultAddress}
            treeVersion={shielded.treeVersion}
            assets={shielded.assets}
            onSubmit={submit}
            onCreated={(note) =>
              setNotes((current) => [
                ...current.filter(
                  (item) => item.commitment !== note.commitment,
                ),
                note,
              ])
            }
          />
        </section>
        <section className="panel ticks p-6">
          <BackupPanel
            notes={notes}
            environment={config.environment}
            chainId={config.chainId}
            vaultAddress={shielded.vaultAddress}
            onRestore={setNotes}
          />
        </section>
        <section className="panel ticks p-6 lg:col-span-2">
          <h2 className="display mb-5 text-2xl">Withdraw an unspent note</h2>
          <WithdrawFlow
            notes={notes}
            onSpent={(spent) =>
              setNotes((current) =>
                current.map((note) =>
                  note.commitment === spent.commitment ? spent : note,
                ),
              )
            }
          />
        </section>
      </div>
    </>
  );
}
