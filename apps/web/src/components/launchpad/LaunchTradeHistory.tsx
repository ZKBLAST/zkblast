"use client";
import { ExternalLink, RefreshCw } from "lucide-react";
import { formatTokenAmount } from "@zkblast/sdk";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { shortHex } from "@/lib/format";
import type { DbcTrade } from "./types";

export function LaunchTradeHistory({
  launchId,
  symbol,
  refreshKey,
}: {
  launchId: string;
  symbol: string;
  refreshKey?: string;
}) {
  const { config } = useApp();
  const [items, setItems] = useState<readonly DbcTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ items: DbcTrade[] }>(
        webPublicConfig.apiUrl,
        `/v1/dbc/launches/${launchId}/trades?limit=50`,
      );
      setItems(result.items);
    } catch {
      // Keep the last validated history visible while a refresh is unavailable.
    } finally {
      setLoading(false);
    }
  }, [launchId, refreshKey]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <section className="border-t border-line">
      <div className="flex items-center justify-between px-4 py-3 sm:px-5">
        <div>
          <p className="label">Curve trade history</p>
          <p className="mt-1 text-[11px] text-muted">
            Validated onchain buy and sell activity
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh trade history"
          className="border border-line p-2 text-muted hover:text-fg"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="overflow-x-auto" data-lenis-prevent>
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead className="border-y border-line text-muted">
            <tr>
              <th className="px-4 py-3 font-normal">Action</th>
              <th className="px-3 py-3 font-normal">Trader</th>
              <th className="px-3 py-3 text-right font-normal">USDG</th>
              <th className="px-3 py-3 text-right font-normal">{symbol}</th>
              <th className="px-3 py-3 text-right font-normal">Price</th>
              <th className="px-3 py-3 font-normal">Time</th>
              <th className="px-4 py-3 font-normal">Tx</th>
            </tr>
          </thead>
          <tbody>
            {items.map((trade) => (
              <tr
                key={`${trade.transaction_hash}:${trade.log_index}`}
                className="border-b border-line/70"
              >
                <td
                  className={`px-4 py-3 font-mono uppercase ${trade.is_buy ? "text-lime" : "text-danger"}`}
                >
                  {trade.is_buy ? "Buy" : "Sell"}
                </td>
                <td className="px-3 py-3 font-mono" title={trade.trader}>
                  {shortHex(trade.trader)}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {formatTokenAmount(BigInt(trade.quote_amount_raw), 6)}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {formatTokenAmount(BigInt(trade.base_amount_raw), 18)}
                </td>
                <td className="px-3 py-3 text-right font-mono">
                  {(Number(trade.price_x18) / 1e18).toPrecision(6)}
                </td>
                <td className="px-3 py-3 text-muted">
                  {new Date(trade.observed_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={`${config?.explorerUrl}/tx/${trade.transaction_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    title={trade.transaction_hash}
                    className="inline-flex items-center gap-1 font-mono text-muted hover:text-fg"
                  >
                    {shortHex(trade.transaction_hash)}
                    <ExternalLink className="size-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className="p-5 text-sm text-muted">No indexed curve trades yet.</p>
        )}
      </div>
    </section>
  );
}
