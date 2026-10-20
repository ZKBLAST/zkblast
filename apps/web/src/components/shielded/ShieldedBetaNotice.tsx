import type { PublicConfig } from "@/types/application";

export function ShieldedBetaNotice({
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
      Experimental mainnet beta. The proving setup was run by one operator and
      has no independent audit or ceremony assurance. Funds may be lost. Use
      only small amounts you can afford to lose. A fixed deposit denomination
      does not cap total deposits.
    </p>
  );
}
