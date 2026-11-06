"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { RealDataState } from "@/components/protocol/real-data-state";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";

type Accounting = Readonly<{
  reserve0: string;
  reserve1: string;
  token0: string;
  token1: string;
  reconciled: boolean;
}>;

export function DammDepthView({
  pool,
  base,
  quote,
  baseDecimals,
  quoteDecimals,
  inverted,
}: {
  pool: string;
  base: string;
  quote: string;
  baseDecimals: number;
  quoteDecimals: number;
  inverted: boolean;
}) {
  const [data, setData] = useState<Accounting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    void apiRequest<Accounting>(webPublicConfig.apiUrl, `/v1/protocol/accounting/${encodeURIComponent(pool)}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setData(response); })
      .catch(() => { if (!controller.signal.aborted) setError("DAMM reserve accounting is temporarily unavailable."); });
    return () => controller.abort();
  }, [pool, retry]);
  const rows = useMemo(() => data ? theoreticalDepth(
    inverted ? data.reserve1 : data.reserve0,
    inverted ? data.reserve0 : data.reserve1,
    baseDecimals,
    quoteDecimals,
  ) : [], [baseDecimals, data, inverted, quoteDecimals]);
  return (
    <section className="min-h-80 p-4" aria-label="Theoretical DAMM depth">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><p className="label">Theoretical DAMM depth</p><p className="mt-1 text-xs text-muted">Constant-product reserve impact · not resting orders</p></div>
        <span className={`border px-2 py-1 font-mono text-[9px] uppercase ${data?.reconciled ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>{data?.reconciled ? "Reserves reconciled" : "Awaiting reconciliation"}</span>
      </div>
      <RealDataState loading={!data && !error} error={error} empty={Boolean(data && !rows.length)} onRetry={() => setRetry((value) => value + 1)} />
      {rows.length ? <div className="overflow-x-auto border border-line"><table className="w-full min-w-[34rem] font-mono text-[10px]"><thead className="text-faint"><tr><th className="p-2 text-left">Side</th><th className="p-2 text-right">Trade size {base}</th><th className="p-2 text-right">Average price {quote}</th><th className="p-2 text-right">Price impact</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.side}:${row.fraction}`} className="border-t border-line"><td className={`p-2 ${row.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{row.side.toUpperCase()}</td><td className="p-2 text-right">{row.baseAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td className="p-2 text-right">{row.averagePrice.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</td><td className="p-2 text-right">{row.impact.toFixed(2)}%</td></tr>)}</tbody></table></div> : null}
    </section>
  );
}

function theoreticalDepth(reserve0Raw: string, reserve1Raw: string, decimals0: number, decimals1: number) {
  const x = Number(formatUnits(BigInt(reserve0Raw), decimals0));
  const y = Number(formatUnits(BigInt(reserve1Raw), decimals1));
  if (!(x > 0 && y > 0)) return [];
  const spot = y / x;
  return [0.001, 0.005, 0.01, 0.025, 0.05].flatMap((fraction) => {
    const sellBase = x * fraction;
    const sellQuoteOut = y - (x * y) / (x + sellBase);
    const buyBase = x * fraction;
    const quoteIn = (x * y) / (x - buyBase) - y;
    return [
      { side: "buy" as const, fraction, baseAmount: buyBase, averagePrice: quoteIn / buyBase, impact: ((quoteIn / buyBase) / spot - 1) * 100 },
      { side: "sell" as const, fraction, baseAmount: sellBase, averagePrice: sellQuoteOut / sellBase, impact: (1 - (sellQuoteOut / sellBase) / spot) * 100 },
    ];
  });
}
