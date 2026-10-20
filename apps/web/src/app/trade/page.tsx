import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeTerminal } from "@/components/trade/TradeTerminal";

export const metadata: Metadata = { title: "Trade" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="px-6 pt-[calc(var(--header-h)+2rem)] text-sm text-muted">
          Loading trading terminal…
        </p>
      }
    >
      <TradeTerminal />
    </Suspense>
  );
}
