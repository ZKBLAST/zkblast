"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { RealDataState } from "@/components/protocol/real-data-state";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";

type TopLpResponse = Readonly<{
  token1Decimals: number;
  coverage: "all_open_positions";
  items: readonly Readonly<{
    rank: number;
    owner: string | null;
    label: string | null;
    privacy: "public" | "shielded_aggregate";
    currentValueToken1Raw: string;
    poolShareBps: string;
    positionCount: number;
    bins: readonly number[];
  }>[];
}>;

export function TopLiquidityProviders({
  pool,
  quoteSymbol,
  refreshKey,
}: {
  pool: string;
  quoteSymbol: string;
  refreshKey: string;
}) {
  const [data, setData] = useState<TopLpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void apiRequest<TopLpResponse>(
      webPublicConfig.apiUrl,
      `/v1/protocol/pools/${encodeURIComponent(pool)}/top-lps?limit=10`,
      { signal: controller.signal },
    ).then((response) => {
      if (!controller.signal.aborted) setData(response);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Liquidity-provider ranking is temporarily unavailable.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [pool, refreshKey, retry]);

  return (
    <section className="mb-5 border border-line" aria-labelledby="top-lps-heading">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 id="top-lps-heading" className="font-mono text-[10px] uppercase text-muted">Top liquidity providers</h3>
        <span className="font-mono text-[9px] uppercase text-faint">Current onchain value</span>
      </div>
      <RealDataState loading={loading} error={error} empty={!data?.items.length} onRetry={async () => setRetry((value) => value + 1)} />
      {!loading && !error && data?.items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-xs">
            <thead className="font-mono text-[9px] uppercase text-faint">
              <tr><th className="p-3">Rank</th><th className="p-3">Provider</th><th className="p-3 text-right">Current value</th><th className="p-3 text-right">Pool share</th><th className="p-3 text-right">Positions</th><th className="p-3">Bins</th></tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={`${item.rank}:${item.owner ?? item.label}`} className="border-t border-line">
                  <td className="p-3 font-mono">#{item.rank}</td>
                  <td className="p-3">
                    {item.privacy === "shielded_aggregate" ? (
                      <span className="font-mono text-lime">Shielded Vault · aggregate</span>
                    ) : (
                      <span className="break-all font-mono text-[10px]">{item.owner}</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">{formatValue(item.currentValueToken1Raw, data.token1Decimals)} {quoteSymbol}</td>
                  <td className="p-3 text-right font-mono">{(Number(item.poolShareBps) / 100).toFixed(2)}%</td>
                  <td className="p-3 text-right font-mono">{item.positionCount}</td>
                  <td className="p-3 font-mono text-[10px] text-muted">{item.bins.length ? compactBins(item.bins) : "Full range"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function formatValue(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : formatUnits(BigInt(raw), decimals);
}

function compactBins(bins: readonly number[]) {
  if (bins.length <= 4) return bins.join(", ");
  return `${bins[0]} – ${bins.at(-1)} · ${bins.length} bins`;
}
