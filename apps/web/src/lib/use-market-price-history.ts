"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { MarketPricePoint } from "@/types/application";

export type PriceSource = "swap" | "oracle" | "reference";
export type ChartRange = "1H" | "1D" | "1W";
const rangeHours: Record<ChartRange, number> = { "1H": 1, "1D": 24, "1W": 168 };

export function useMarketPriceHistory(
  marketId: string | null,
  source: PriceSource,
  range: ChartRange = "1W",
) {
  const requestId = useRef(0);
  const key = `${marketId}:${source}:${range}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    items: readonly MarketPricePoint[];
    loading: boolean;
    error: string | null;
  }>({ key, items: [], loading: Boolean(marketId), error: null });
  const refresh = useCallback(async () => {
    const current = ++requestId.current;
    if (!marketId) {
      setSnapshot({ key, items: [], loading: false, error: null });
      return;
    }
    setSnapshot({ key, items: [], loading: true, error: null });
    const to = new Date();
    const from = new Date(to.getTime() - rangeHours[range] * 3_600_000);
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
      if (current === requestId.current)
        setSnapshot({
          key,
          items: response.items,
          loading: false,
          error: null,
        });
    } catch (reason) {
      if (current === requestId.current)
        setSnapshot({
          key,
          items: [],
          loading: false,
          error:
            reason instanceof Error ? reason.message : "CHART_DATA_UNAVAILABLE",
        });
    }
  }, [marketId, source, range, key]);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);
  const visible =
    snapshot.key === key
      ? snapshot
      : { items: [], loading: Boolean(marketId), error: null };
  return { ...visible, refresh };
}
