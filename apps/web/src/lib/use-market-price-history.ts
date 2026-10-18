"use client";

import { useCallback, useEffect, useState } from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { MarketPricePoint } from "@/types/application";

export type PriceSource = "swap" | "oracle" | "reference";

export function useMarketPriceHistory(
  marketId: string | null,
  source: PriceSource,
) {
  const [items, setItems] = useState<readonly MarketPricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!marketId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const query = new URLSearchParams({
      source,
      from: from.toISOString(),
      to: to.toISOString(),
      limit: "1000",
    });
    try {
      const response = await apiRequest<{ items: MarketPricePoint[] }>(
        webPublicConfig.apiUrl,
        `/v1/markets/${marketId}/chart?${query.toString()}`,
      );
      setItems(response.items);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "CHART_DATA_UNAVAILABLE",
      );
    } finally {
      setLoading(false);
    }
  }, [marketId, source]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { items, loading, error, refresh };
}
