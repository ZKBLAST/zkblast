"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { MarketPricePoint } from "@/types/application";
import {
  chartRangeHours,
  type PriceSource,
  type ChartRange,
} from "./market-chart-data";
export type { PriceSource, ChartRange } from "./market-chart-data";

export function useMarketPriceHistory(
  marketId: string | null,
  source: PriceSource,
  range: ChartRange = "1W",
  poolAddress: string | null = null,
) {
  const available =
    source === "swap" ? Boolean(poolAddress) : Boolean(marketId);
  const requestId = useRef(0);
  const key = `${marketId}:${poolAddress}:${source}:${range}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    items: readonly MarketPricePoint[];
    loading: boolean;
    error: string | null;
  }>({ key, items: [], loading: available, error: null });
  const refresh = useCallback(
    async (background = false) => {
      const current = ++requestId.current;
      if (!available) {
        setSnapshot({ key, items: [], loading: false, error: null });
        return;
      }
      if (!background)
        setSnapshot({ key, items: [], loading: true, error: null });
      const to = new Date();
      const from = new Date(to.getTime() - chartRangeHours[range] * 3_600_000);
      const query = new URLSearchParams({
        source,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: "2000",
      });
      try {
        const response = await apiRequest<{ items: MarketPricePoint[] }>(
          webPublicConfig.apiUrl,
          source === "swap" && poolAddress
            ? `/v1/protocol/pools/${encodeURIComponent(poolAddress)}/chart?${query.toString()}`
            : `/v1/markets/${marketId}/chart?${query.toString()}`,
        );
        const units = new Set(
          response.items.map((item) => item.priceUnit).filter(Boolean),
        );
        if (units.size > 1) throw new Error("CHART_DENOMINATION_MISMATCH");
        if (current === requestId.current)
          setSnapshot({
            key,
            items: response.items,
            loading: false,
            error: null,
          });
      } catch (reason) {
        if (current === requestId.current)
          setSnapshot((previous) => ({
            key,
            items: background && previous.key === key ? previous.items : [],
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "CHART_DATA_UNAVAILABLE",
          }));
      }
    },
    [marketId, poolAddress, available, source, range, key],
  );
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 60_000);
    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
    };
  }, [refresh]);
  const visible =
    snapshot.key === key
      ? snapshot
      : { items: [], loading: available, error: null };
  return { ...visible, refresh: () => refresh() };
}
