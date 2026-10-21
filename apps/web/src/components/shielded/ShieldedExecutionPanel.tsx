"use client";

import { useState } from "react";
import { ShieldedView } from "@/app/shielded/ShieldedView";
import { useApp } from "@/components/shell/AppProvider";
import { TerminalTabs } from "@/components/trade/TerminalTabs";
import type { ProtocolExecutionPool } from "@/types/application";
import { PrivateVaultV2Panel } from "./PrivateVaultV2Panel";

export function ShieldedExecutionPanel({
  pool,
  busy,
  onBusyChange,
}: {
  pool: ProtocolExecutionPool | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { config } = useApp();
  const [tab, setTab] = useState("vault");
  return (
    <>
      {config?.environment === "testnet" && (
        <TerminalTabs
          prefix="shielded-version"
          label="Shielded protocol"
          items={[
            { value: "vault", label: "USDG vault" },
            { value: "v2", label: "Private v2" },
          ]}
          value={tab}
          onChange={setTab}
          disabled={busy}
        />
      )}
      <div hidden={config?.environment === "testnet" && tab !== "vault"}>
        <p className="border-b border-line p-4 text-xs leading-relaxed text-muted">
          Deposit and withdraw supported assets. Save your note backup before
          depositing.
        </p>
        <ShieldedView compact />
      </div>
      {config?.environment === "testnet" && (
        <div hidden={tab !== "v2"}>
          <PrivateVaultV2Panel pool={pool} onBusyChange={onBusyChange} />
        </div>
      )}
    </>
  );
}
