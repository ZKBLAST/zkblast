"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "./api-client";

export type AssistanceSummary = Readonly<{
  assets: readonly Readonly<{
    assetAddress: string;
    eligibleAmountRaw: string;
    allocatedBuybackRaw: string;
    allocatedTreasuryRaw: string;
  }>[];
  windows: Readonly<{
    eligible24hRaw: string;
    eligible7dRaw: string;
    eligible30dRaw: string;
  }>;
  reconciliation: readonly Readonly<{
    assetAddress: string;
    balanceRaw: string;
    pendingBuybackRaw: string;
    treasuryClaimableRaw: string;
    liabilityRaw: string;
    surplusRaw: string;
    solvent: boolean;
    blockNumber: string;
  }>[];
  burnedProtocolTokenRaw: string;
  latestBlock: string | null;
}>;

export type AssistanceReceipt = Readonly<{
  transactionHash: string;
  blockNumber: string;
  observedAt: string;
  routeId?: string;
  sourceId?: string;
  assetAddress?: string;
  assetIn?: string;
  eligibleAmountRaw?: string;
  amountInRaw?: string;
  amountOutRaw?: string;
  amountRaw?: string;
  referencePriceX18?: string;
  executionPriceX18?: string;
  burnMethod?: number;
  totalSupplyBeforeRaw?: string;
  totalSupplyAfterRaw?: string;
}>;

const emptySummary: AssistanceSummary = {
  assets: [],
  windows: { eligible24hRaw: "0", eligible7dRaw: "0", eligible30dRaw: "0" },
  reconciliation: [],
  burnedProtocolTokenRaw: "0",
  latestBlock: null,
};

export function useAssistanceFund() {
  const { config } = useApp();
  const [summary, setSummary] = useState(emptySummary);
  const [revenue, setRevenue] = useState<readonly AssistanceReceipt[]>([]);
  const [buybacks, setBuybacks] = useState<readonly AssistanceReceipt[]>([]);
  const [burns, setBurns] = useState<readonly AssistanceReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!config) return;
    if (!loaded.current) setLoading(true);
    try {
      const [nextSummary, nextRevenue, nextBuybacks, nextBurns] =
        await Promise.all([
          apiRequest<AssistanceSummary>("/api", "/v1/assistance-fund/summary"),
          apiRequest<{ items: AssistanceReceipt[] }>(
            "/api",
            "/v1/assistance-fund/revenue?limit=100",
          ),
          apiRequest<{ items: AssistanceReceipt[] }>(
            "/api",
            "/v1/assistance-fund/buybacks?limit=100",
          ),
          apiRequest<{ items: AssistanceReceipt[] }>(
            "/api",
            "/v1/assistance-fund/burns?limit=100",
          ),
        ]);
      setSummary(nextSummary);
      setRevenue(nextRevenue.items);
      setBuybacks(nextBuybacks.items);
      setBurns(nextBurns.items);
      setAvailable(true);
      setError(null);
      loaded.current = true;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "ASSISTANCE_FUND_UNAVAILABLE";
      setAvailable(!["HTTP_404", "FEATURE_NOT_CONFIGURED"].includes(message));
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    loaded.current = false;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!config || !available) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [available, config, refresh]);

  return {
    summary,
    revenue,
    buybacks,
    burns,
    loading,
    available,
    error,
    refresh,
  };
}
