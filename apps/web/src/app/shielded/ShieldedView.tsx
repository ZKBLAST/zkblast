"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { BackupPanel } from "@/components/shielded/BackupPanel";
import { DepositFlow } from "@/components/shielded/DepositFlow";
import { WithdrawFlow } from "@/components/shielded/WithdrawFlow";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge } from "@/components/ui/Badges";
import { PageHeader } from "@/components/ui/PageHeader";
import internalTestAssets from "@/data/internal-test-assets.json";
import { executeShieldedDeposit } from "@/lib/shielded-deposit";
import type { ShieldedNoteV1 } from "@/lib/notecrypto";
import { TerminalTabs } from "@/components/trade/TerminalTabs";

export function ShieldedView({ compact = false }: { compact?: boolean } = {}) {
  const { address, config } = useApp();
  const [notes, setNotes] = useState<readonly ShieldedNoteV1[]>([]);
  const [vaultTab, setVaultTab] = useState("deposit");
  const shielded = config?.shielded;
  const publicAssets = shielded?.assets.filter(
    (asset) => !internalTestAssets.symbols.includes(asset.symbol),
  );
  if (!config)
    return (
      <p className="p-5 text-sm text-muted" role="status">
        Loading vault configuration…
      </p>
    );

  if (!config || !shielded || !publicAssets?.length) {
    return (
      <>
        {!compact && (
          <PageHeader
            title="Shielded vault"
            lead="No user-facing shielded asset is enabled for the active network."
            badges={
              <LaneBadge
                lane="shielded"
                stage={config?.environment === "testnet"}
              />
            }
          />
        )}
        <div
          className={compact ? "p-3" : "mx-auto max-w-[1360px] px-4 sm:px-6"}
        >
          <section className="panel ticks flex items-start gap-4 p-8">
            <ShieldAlert className="size-6 shrink-0 text-warn" aria-hidden />
            <div>
              <h2 className="wide text-base">
                Shielded deposits are unavailable
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                The active network has no governance-approved public shielded
                asset. Controls remain disabled until governance configures and
                verifies a user-facing asset such as USDG. The UI will not
                relabel or substitute a different token address.
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
      {!compact && (
        <PageHeader
          title="Shielded vault"
          lead="Create the note locally, save an encrypted backup, then deposit the exact governance-approved denomination."
          badges={
            <LaneBadge
              lane="shielded"
              stage={config.environment === "testnet"}
            />
          }
        />
      )}
      <div
        className={
          compact
            ? "grid gap-3 p-3"
            : "mx-auto grid max-w-[1360px] gap-6 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]"
        }
      >
        {compact && (
          <TerminalTabs
            prefix="vault"
            label="Vault actions"
            value={vaultTab}
            onChange={setVaultTab}
            items={[
              { value: "deposit", label: "Deposit" },
              { value: "backup", label: "Backup" },
              { value: "withdraw", label: "Withdraw" },
            ]}
          />
        )}
        <section
          className={`panel ticks border-warn/40 p-5 ${compact ? "" : "lg:col-span-2"}`}
        >
          <h2 className="wide text-sm text-warn">
            Aggregate LP privacy boundary
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Shielded notes hide note ownership data, not AMM activity. Any
            future vault-managed LP position will expose its pool, assets,
            reserves, manager shares, investment and redemption amounts, blocks,
            and timing. The LP manager remains undeployed pending independent
            review and does not currently hold user funds.
          </p>
        </section>
        <section
          className="panel ticks p-6"
          hidden={compact && vaultTab !== "deposit"}
          {...(compact
            ? {
                role: "tabpanel",
                id: "vault-panel-deposit",
                "aria-labelledby": "vault-tab-deposit",
              }
            : {})}
        >
          <DepositFlow
            environment={config.environment}
            chainId={config.chainId}
            vaultAddress={shielded.vaultAddress}
            treeVersion={shielded.treeVersion}
            assets={publicAssets}
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
        <section
          className="panel ticks p-6"
          hidden={compact && vaultTab !== "backup"}
          {...(compact
            ? {
                role: "tabpanel",
                id: "vault-panel-backup",
                "aria-labelledby": "vault-tab-backup",
              }
            : {})}
        >
          <BackupPanel
            notes={notes}
            environment={config.environment}
            chainId={config.chainId}
            vaultAddress={shielded.vaultAddress}
            onRestore={setNotes}
          />
        </section>
        <section
          className={`panel ticks p-6 ${compact ? "" : "lg:col-span-2"}`}
          hidden={compact && vaultTab !== "withdraw"}
          {...(compact
            ? {
                role: "tabpanel",
                id: "vault-panel-withdraw",
                "aria-labelledby": "vault-tab-withdraw",
              }
            : {})}
        >
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
