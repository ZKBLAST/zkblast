"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { MarketPricePoint } from "@/types/application";
import { resolveChartSource } from "./resolve-chart-source";
import {
  chartRangeHours,
  type PriceSource,
  type ChartRange,
} from "./market-chart-data";
export type { PriceSource, ChartRange } from "./market-chart-data";

export function useMarketPriceHistory(
  marketId: string | null,
  source: PriceSource | "auto",
  range: ChartRange = "1W",
  poolAddress: string | null = null,
) {
  const available =
    source === "swap" ? Boolean(poolAddress) : Boolean(marketId);
  const requestId = useRef(0);
  const key = `${marketId}:${poolAddress}:${source}:${range}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    source: PriceSource;
    items: readonly MarketPricePoint[];
    loading: boolean;
    error: string | null;
  }>({
    key,
    source: source === "auto" ? "oracle" : source,
    items: [],
    loading: available,
    error: null,
  });
  const initialSource = source === "auto" ? "oracle" : source;
  const refresh = useCallback(
    async (background = false) => {
      const current = ++requestId.current;
      if (!available) {
        setSnapshot({
          key,
          source: initialSource,
          items: [],
          loading: false,
          error: null,
        });
        return;
      }
      if (!background)
        setSnapshot({
          key,
          source: initialSource,
          items: [],
          loading: true,
          error: null,
        });
      const to = new Date();
      const from = new Date(to.getTime() - chartRangeHours[range] * 3_600_000);
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        limit: "2000",
      });
      try {
        const response = await resolveChartSource(source, async (selected) => {
          query.set("source", selected);
          const result = await apiRequest<{ items: MarketPricePoint[] }>(
            webPublicConfig.apiUrl,
            selected === "swap" && poolAddress
              ? `/v1/protocol/pools/${encodeURIComponent(poolAddress)}/chart?${query.toString()}`
              : `/v1/markets/${marketId}/chart?${query.toString()}`,
          );
          return result.items;
        });
        const units = new Set(
          response.items.map((item) => item.priceUnit).filter(Boolean),
        );
        if (units.size > 1) throw new Error("CHART_DENOMINATION_MISMATCH");
        if (current === requestId.current)
          setSnapshot({
            key,
            source: response.source,
            items: response.items,
            loading: false,
            error: null,
          });
      } catch (reason) {
        if (current === requestId.current)
          setSnapshot((previous) => ({
            key,
            source:
              background && previous.key === key
                ? previous.source
                : initialSource,
            items: background && previous.key === key ? previous.items : [],
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "CHART_DATA_UNAVAILABLE",
          }));
      }
    },
    [marketId, poolAddress, available, source, range, key, initialSource],
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
      : { source: initialSource, items: [], loading: available, error: null };
  return { ...visible, refresh: () => refresh() };
}
