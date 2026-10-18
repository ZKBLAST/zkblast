"use client";

import { useCallback, useEffect, useState } from "react";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import internalTestAssets from "@/data/internal-test-assets.json";
import type {
  IndexerMetrics,
  ProtocolPool,
  ProtocolPosition,
  ProtocolSwap,
} from "@/types/application";

type ProtocolData = Readonly<{
  pools: readonly ProtocolPool[];
  swaps: readonly ProtocolSwap[];
  positions: readonly ProtocolPosition[];
  metrics: IndexerMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>;

const hiddenSymbols = new Set(internalTestAssets.symbols);
const isPublicPair = (token0: string, token1: string) =>
  !hiddenSymbols.has(token0) && !hiddenSymbols.has(token1);

export function useProtocolData(owner?: string | null): ProtocolData {
  const [pools, setPools] = useState<readonly ProtocolPool[]>([]);
  const [swaps, setSwaps] = useState<readonly ProtocolSwap[]>([]);
  const [positions, setPositions] = useState<readonly ProtocolPosition[]>([]);
  const [metrics, setMetrics] = useState<IndexerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ownerQuery = owner ? `&owner=${encodeURIComponent(owner)}` : "";
      const [poolPage, swapPage, positionPage, nextMetrics] = await Promise.all(
        [
          apiRequest<{ items: ProtocolPool[] }>(
            webPublicConfig.apiUrl,
            "/v1/protocol/pools?limit=100",
          ),
          apiRequest<{ items: ProtocolSwap[] }>(
            webPublicConfig.apiUrl,
            "/v1/protocol/swaps?limit=100",
          ),
          apiRequest<{ items: ProtocolPosition[] }>(
            webPublicConfig.apiUrl,
            `/v1/protocol/positions?limit=100${ownerQuery}`,
          ),
          apiRequest<IndexerMetrics>(
            webPublicConfig.apiUrl,
            "/v1/protocol/metrics",
          ),
        ],
      );
      setPools(
        poolPage.items.filter((pool) =>
          isPublicPair(pool.token0Symbol, pool.token1Symbol),
        ),
      );
      setSwaps(swapPage.items);
      setPositions(
        positionPage.items.filter((position) =>
          isPublicPair(position.token0Symbol, position.token1Symbol),
        ),
      );
      setMetrics(nextMetrics);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "PROTOCOL_DATA_UNAVAILABLE",
      );
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { pools, swaps, positions, metrics, loading, error, refresh };
}
