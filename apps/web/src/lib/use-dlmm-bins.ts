"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";

export type DlmmBins = Readonly<{
  chainId: number;
  pool: string;
  activeBin: number;
  binStepBps: number;
  bins: readonly Readonly<{
    binId: number;
    reserve0: string;
    reserve1: string;
    totalShares: string;
    priceX18: string;
  }>[];
}>;

export function useDlmmBins(pool: string | undefined, revision = 0) {
  const [data, setData] = useState<DlmmBins | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(Boolean(pool));
    if (!pool) return;
    void apiRequest<DlmmBins>(
      webPublicConfig.apiUrl,
      `/v1/protocol/bins/${encodeURIComponent(pool)}`,
    )
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch(() => {
        if (!cancelled) setError("Bin liquidity is temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pool, revision]);
  return { data, loading, error };
}
