"use client";

import { useApp } from "@/components/shell/AppProvider";
import type { ProtocolExecutionPool } from "@/types/application";
import { PrivateVaultV2Panel } from "./PrivateVaultV2Panel";

export function ShieldedExecutionPanel({
  pool,
  onBusyChange,
}: {
  pool: ProtocolExecutionPool | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { config } = useApp();
  const privateV2Available = Boolean(config?.shieldedV2?.proverRelease);
  if (!privateV2Available)
    return (
      <p className="p-5 text-sm leading-relaxed text-muted">
        Shielded execution is not configured for this network.
      </p>
    );
  return <PrivateVaultV2Panel pool={pool} onBusyChange={onBusyChange} />;
}
