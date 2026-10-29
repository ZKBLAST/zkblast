"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
} from "react";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { ExternalMarket } from "@/types/application";

type MarketData = {
  items: readonly ExternalMarket[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
export const MarketDataContext = createContext<MarketData | null>(null);

export function useExternalMarkets(): MarketData {
  const shared = useContext(MarketDataContext);
  const [items, setItems] = useState<readonly ExternalMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (shared) return shared.refresh();
    setLoading(true);
    setError(null);
    try {
      const [pons, usStocks, chinaStocks, unclassifiedStocks] =
        await Promise.all([
          apiRequest<{ items: ExternalMarket[] }>(
            webPublicConfig.apiUrl,
            "/v1/markets?source=pons_graduated&minMarketCapUsd=1000000&limit=100",
          ),
          apiRequest<{ items: ExternalMarket[] }>(
            webPublicConfig.apiUrl,
            "/v1/markets?source=robinhood_stock_token&region=us&limit=200",
          ),
          apiRequest<{ items: ExternalMarket[] }>(
            webPublicConfig.apiUrl,
            "/v1/markets?source=robinhood_stock_token&region=china&limit=200",
          ),
          apiRequest<{ items: ExternalMarket[] }>(
            webPublicConfig.apiUrl,
            "/v1/markets?source=robinhood_stock_token&region=unclassified&limit=200",
          ), 
        ]);
      const combined = [
        ...pons.items,
        ...usStocks.items,
        ...chinaStocks.items,
        ...unclassifiedStocks.items,
      ];
      combined.sort((left, right) => {
        const leftIsProtocol = left.symbol.toUpperCase() === "ZKBLAST" ? 1 : 0;
        const rightIsProtocol =
          right.symbol.toUpperCase() === "ZKBLAST" ? 1 : 0;
        if (leftIsProtocol !== rightIsProtocol) {
          return rightIsProtocol - leftIsProtocol;
        }
        return Number(right.canTrade) - Number(left.canTrade);
      });
      setItems(combined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "MARKET_DATA_UNAVAILABLE",
      );
    } finally {
      setLoading(false);
    }
  }, [shared]);
  useEffect(() => {
    if (shared) return;
    void refresh();
  }, [refresh, shared]);
  return shared ?? { items, loading, error, refresh };
}
