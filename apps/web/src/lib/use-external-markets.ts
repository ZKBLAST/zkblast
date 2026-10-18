"use client";

import { useCallback, useEffect, useState } from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { ExternalMarket } from "@/types/application";

export function useExternalMarkets() {
  const [items, setItems] = useState<readonly ExternalMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pons, usStocks, chinaStocks] = await Promise.all([
        apiRequest<{ items: ExternalMarket[] }>(
          webPublicConfig.apiUrl,
          "/v1/markets?source=pons_graduated&minMarketCapUsd=1000000&limit=100",
        ),
        apiRequest<{ items: ExternalMarket[] }>(
          webPublicConfig.apiUrl,
          "/v1/markets?source=robinhood_stock_token&region=us&limit=100",
        ),
        apiRequest<{ items: ExternalMarket[] }>(
          webPublicConfig.apiUrl,
          "/v1/markets?source=robinhood_stock_token&region=china&limit=100",
        ),
      ]);
      setItems([...pons.items, ...usStocks.items, ...chinaStocks.items]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "MARKET_DATA_UNAVAILABLE",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { items, loading, error, refresh };
}
