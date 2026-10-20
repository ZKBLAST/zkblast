"use client";

import { ArrowLeftRight, Layers, Shield } from "lucide-react";
import { ShieldedView } from "@/app/shielded/ShieldedView";
import { ProtocolPoolWorkspace } from "@/components/protocol/ProtocolPoolWorkspace";
import type { TradeInstrument, TradeMode } from "@/lib/trade-instruments";
import { TerminalTabs } from "./TerminalTabs";

const actions = [
  { value: "swap", label: "Swap", icon: ArrowLeftRight },
  { value: "liquidity", label: "Liquidity", icon: Layers },
  { value: "shielded", label: "Shielded", icon: Shield },
];

export function TradeActions({
  selected,
  mode,
  busy,
  onModeChange,
  onBusyChange,
  onConfirmed,
}: {
  selected: TradeInstrument | undefined;
  mode: TradeMode;
  busy: boolean;
  onModeChange: (mode: string) => void;
  onBusyChange: (busy: boolean) => void;
  onConfirmed: () => void;
}) {
  const publicMode = mode === "liquidity" ? "liquidity" : "swap";
  return (
    <aside
      className="min-w-0 border-t border-line xl:border-l xl:border-t-0"
      aria-label="Trade actions"
    >
      <TerminalTabs
        prefix="action"
        label="Action"
        items={actions}
        value={mode}
        disabled={busy}
        onChange={onModeChange}
      />
      {(["swap", "liquidity"] as const).map((value) => (
        <div
          key={value}
          role="tabpanel"
          id={`action-panel-${value}`}
          aria-labelledby={`action-tab-${value}`}
          hidden={mode !== value}
        >
          {publicMode === value &&
            (selected?.pool ? (
              <ProtocolPoolWorkspace
                key={selected.pool.address}
                compact
                pool={selected.pool}
                mode={publicMode}
                onBusyChange={onBusyChange}
                onConfirmed={onConfirmed}
              />
            ) : (
              <p className="p-5 text-sm leading-relaxed text-muted">
                You can browse this market's chart. Swaps and liquidity become
                available only after its onchain execution pool is validated and
                funded.
              </p>
            ))}
        </div>
      ))}
      <div
        role="tabpanel"
        id="action-panel-shielded"
        aria-labelledby="action-tab-shielded"
        hidden={mode !== "shielded"}
      >
        <p className="border-b border-line p-4 text-xs leading-relaxed text-muted">
          Network vault · deposit and withdraw supported assets. This is not a
          shielded swap of the selected market. Save your note backup before
          depositing.
        </p>
        <ShieldedView compact />
      </div>
    </aside>
  );
}
