"use client";

import { ArrowLeftRight, Layers, Shield } from "lucide-react";
import { ShieldedView } from "@/app/shielded/ShieldedView";
import { ProtocolPoolWorkspace } from "@/components/protocol/ProtocolPoolWorkspace";
import type { TradeInstrument, TradeMode } from "@/lib/trade-instruments";
import { TerminalTabs } from "./TerminalTabs";
import { CreatePoolPanel } from "@/components/protocol/CreatePoolPanel";

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
      className="min-h-0 min-w-0 border-t border-line xl:overflow-y-auto xl:border-l xl:border-t-0"
      aria-label="Trade actions"
    >
      <TerminalTabs
        prefix="action"
        label="Action"
        items={actions}
        value={mode === "create" ? "liquidity" : mode}
        disabled={busy}
        onChange={onModeChange}
      />
      {(mode === "liquidity" || mode === "create") && (
        <TerminalTabs
          prefix="liquidity"
          label="Liquidity tools"
          value={mode}
          disabled={busy}
          onChange={onModeChange}
          items={[
            { value: "liquidity", label: "Add liquidity" },
            { value: "create", label: "Create pool" },
          ]}
        />
      )}
      {mode === "create" && (
        <div
          role="tabpanel"
          id="action-panel-liquidity"
          aria-labelledby="action-tab-liquidity"
        >
          <div
            role="tabpanel"
            id="liquidity-panel-create"
            aria-labelledby="liquidity-tab-create"
          >
            <CreatePoolPanel
              onBusyChange={onBusyChange}
              onConfirmed={onConfirmed}
            />
          </div>
        </div>
      )}
      {(["swap", "liquidity"] as const)
        .filter(() => mode !== "create")
        .map((value) => (
          <div
            key={value}
            role="tabpanel"
            id={`action-panel-${value}`}
            aria-labelledby={`action-tab-${value}`}
            hidden={mode !== value}
          >
            <div
              role={value === "liquidity" ? "tabpanel" : undefined}
              id={
                value === "liquidity" ? "liquidity-panel-liquidity" : undefined
              }
              aria-labelledby={
                value === "liquidity" ? "liquidity-tab-liquidity" : undefined
              }
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
                    You can browse this market's chart. Swaps and liquidity
                    become available only after its onchain execution pool is
                    validated and funded.
                  </p>
                ))}
            </div>
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
