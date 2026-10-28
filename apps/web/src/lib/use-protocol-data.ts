"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import internalTestAssets from "@/data/internal-test-assets.json";
import type {
  IndexerMetrics,
  ProtocolActivity,
  ProtocolPool,
  ProtocolPosition,
  ProtocolSwap,
} from "@/types/application";

export type ProtocolData = Readonly<{
  pools: readonly ProtocolPool[];
  swaps: readonly ProtocolSwap[];
  activity: readonly ProtocolActivity[];
  accountActivity: readonly ProtocolActivity[];
  positions: readonly ProtocolPosition[];
  metrics: IndexerMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>;

export const ProtocolDataContext = createContext<{
  owner: string | null | undefined;
  data: ProtocolData;
} | null>(null);

const hiddenSymbols = new Set(internalTestAssets.symbols);
const isPublicPair = (token0: string, token1: string) =>
  !hiddenSymbols.has(token0) && !hiddenSymbols.has(token1);

export function useProtocolData(owner?: string | null): ProtocolData {
  const context = useContext(ProtocolDataContext);
  const shared =
    context && (!owner || owner === context.owner) ? context.data : null;
  const requestId = useRef(0);
  const [pools, setPools] = useState<readonly ProtocolPool[]>([]);
  const [swaps, setSwaps] = useState<readonly ProtocolSwap[]>([]);
  const [activity, setActivity] = useState<readonly ProtocolActivity[]>([]);
  const [accountActivity, setAccountActivity] = useState<
    readonly ProtocolActivity[]
  >([]);
  const [positions, setPositions] = useState<readonly ProtocolPosition[]>([]);
  const [positionsOwner, setPositionsOwner] = useState(owner);
  const [metrics, setMetrics] = useState<IndexerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (shared) return shared.refresh();
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const ownerQuery = owner ? `&owner=${encodeURIComponent(owner)}` : "";
      const [
        poolPage,
        swapPage,
        activityPage,
        accountActivityPage,
        positionPage,
        nextMetrics,
      ] = await Promise.all(
        [
          apiRequest<{ items: ProtocolPool[] }>(
            webPublicConfig.apiUrl,
            "/v1/protocol/pools?limit=100",
          ),
          apiRequest<{ items: ProtocolSwap[] }>(
            webPublicConfig.apiUrl,
            "/v1/protocol/swaps?limit=100",
          ),
          apiRequest<{ items: ProtocolActivity[] }>(
            webPublicConfig.apiUrl,
            "/v1/protocol/activity?limit=100",
          ),
          owner
            ? apiRequest<{ items: ProtocolActivity[] }>(
                webPublicConfig.apiUrl,
                `/v1/protocol/activity?limit=100${ownerQuery}`,
              )
            : Promise.resolve({ items: [] as ProtocolActivity[] }),
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
      if (currentRequest !== requestId.current) return;
      setPositionsOwner(owner);
      setPools(
        poolPage.items
          .filter((pool) =>
            isPublicPair(pool.token0Symbol, pool.token1Symbol),
          )
          .sort(
            (left, right) =>
              Number(right.createdBlock || "0") -
              Number(left.createdBlock || "0"),
          ),
      );
      setSwaps(swapPage.items);
      setActivity(activityPage.items);
      setAccountActivity(accountActivityPage.items);
      setPositions(
        positionPage.items.filter((position) =>
          isPublicPair(position.token0Symbol, position.token1Symbol),
        ),
      );
      setMetrics(nextMetrics);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      setError(
        reason instanceof Error ? reason.message : "PROTOCOL_DATA_UNAVAILABLE",
      );
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [owner, shared]);

  useEffect(() => {
    if (shared) return;
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh, shared]);
  if (shared) return shared;
  return {
    pools,
    swaps,
    activity,
    accountActivity,
    positions: positionsOwner === owner ? positions : [],
    metrics,
    loading,
    error,
    refresh,
  };
}
