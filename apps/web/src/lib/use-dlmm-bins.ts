"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { dlmmBinsTouchedEvent, type DlmmBinsTouchedDetail } from "./dlmm-bin-events";

export type DlmmBins = Readonly<{
  chainId: number;
  pool: string;
  activeBin: number;
  binStepBps: number;
  minimumLockedLiquidity?: string;
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
  useEffect(() => {
    if (!pool) return;
    const normalizedPool = pool.toLowerCase();
    function refreshTouched(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as Partial<DlmmBinsTouchedDetail> | undefined;
      if (
        !detail ||
        detail.pool !== normalizedPool ||
        !Number.isInteger(detail.lower) ||
        !Number.isInteger(detail.upper)
      ) return;
      const lower = Math.max(-10_000, Number(detail.lower));
      const upper = Math.min(10_000, Number(detail.upper));
      if (lower > upper || upper - lower >= 121) return;
      void apiRequest<DlmmBins>(
        webPublicConfig.apiUrl,
        `/v1/protocol/bins/${encodeURIComponent(normalizedPool)}?lower=${lower}&upper=${upper}&skipEmpty=false`,
      ).then((update) => setData((current) => {
        if (!current || current.pool.toLowerCase() !== update.pool.toLowerCase()) return update;
        const merged = new Map(current.bins.map((bin) => [bin.binId, bin]));
        for (const bin of update.bins) merged.set(bin.binId, bin);
        return {
          ...current,
          activeBin: update.activeBin,
          bins: [...merged.values()].sort((left, right) => left.binId - right.binId),
        };
      })).catch(() => {
        /* The next scheduled snapshot refresh remains authoritative. */
      });
    }
    window.addEventListener(dlmmBinsTouchedEvent, refreshTouched);
    return () => window.removeEventListener(dlmmBinsTouchedEvent, refreshTouched);
  }, [pool]);
  return { data, loading, error };
}
