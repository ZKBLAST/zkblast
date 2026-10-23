"use client";

import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { ShieldedView } from "@/app/shielded/ShieldedView";
import { LaneBadge } from "@/components/ui/Badges";
import {
  PRIVATE_V2_SUMMARY_EVENT,
  type PrivateV2SessionSummary,
} from "@/lib/private-v2-session-summary";

export function ShieldedPositionsPanel() {
  const [summary, setSummary] = useState<PrivateV2SessionSummary | null>(null);

  useEffect(() => {
    const update = (event: Event) =>
      setSummary(
        (event as CustomEvent<PrivateV2SessionSummary | null>).detail,
      );
    window.addEventListener(PRIVATE_V2_SUMMARY_EVENT, update);
    return () => window.removeEventListener(PRIVATE_V2_SUMMARY_EVENT, update);
  }, []);

  return (
    <section className="mb-4 border border-line bg-panel/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">Shielded positions</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Private note details stay in the unlocked browser session.
            </p>
          </div>
        </div>
        <LaneBadge lane="shielded" stage={false} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        {[
          ["Token notes", summary?.tokenNotes],
          ["Private LP", summary?.lpNotes],
          ["Active intents", summary?.activeIntents],
          ["Transactions", summary?.transactions],
        ].map(([label, value]) => (
          <div key={label} className="bg-bg p-3">
            <dt className="text-[10px] uppercase tracking-wide text-faint">
              {label}
            </dt>
            <dd className="mt-1 font-mono text-base">
              {value === undefined ? "—" : value}
            </dd>
          </div>
        ))}
      </dl>
      {!summary && (
        <p className="mt-3 text-xs text-muted">
          Open Shielded and unlock your recovery journal to display private
          token notes, LP notes and pending transactions here.
        </p>
      )}
      <details className="mt-4 border-t border-line pt-4">
        <summary className="cursor-pointer text-xs text-muted">
          Manage legacy USDG notes
        </summary>
        <div className="mt-3 border border-line">
          <ShieldedView compact />
        </div>
      </details>
    </section>
  );
}
