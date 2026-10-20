import type { PublicConfig } from "@/types/application";
import { shieldedSetupNotice } from "@/lib/shielded-risk-copy";

export function ShieldedRiskNotice({
  config,
}: {
  config?: PublicConfig | null;
}) {
  if (
    config?.environment !== "mainnet" ||
    config.shielded?.launchMode !== "experimental-single-operator"
  )
    return null;
  return (
    <p
      role="alert"
      className="mb-4 border border-warn/40 p-4 text-sm text-warn"
    >
      <strong className="mb-1 block">Before you deposit</strong>
      {shieldedSetupNotice}
    </p>
  );
}
