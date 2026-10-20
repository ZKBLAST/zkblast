"use client";

import type { ReactNode } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { ProtocolDataContext, useProtocolData } from "@/lib/use-protocol-data";
import {
  MarketDataContext,
  useExternalMarkets,
} from "@/lib/use-external-markets";

export function TradeDataProvider({ children }: { children: ReactNode }) {
  const { address } = useApp();
  const data = useProtocolData(address);
  const markets = useExternalMarkets();
  return (
    <ProtocolDataContext.Provider value={{ owner: address, data }}>
      <MarketDataContext.Provider value={markets}>
        {children}
      </MarketDataContext.Provider>
    </ProtocolDataContext.Provider>
  );
}
