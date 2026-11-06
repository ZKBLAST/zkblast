"use client";

import { useDlmmBins } from "@/lib/use-dlmm-bins";
import { dlmmDepthRows } from "@/lib/dlmm-depth";
import { Skeleton } from "@/components/ui/Skeleton";

export function DlmmDepthBook({
  pool,
  base,
  quote,
  baseDecimals,
  quoteDecimals,
  inverted = false,
  mode,
}: {
  pool: string;
  base: string;
  quote: string;
  baseDecimals: number;
  quoteDecimals: number;
  inverted?: boolean;
  mode: "depth" | "book";
}) {
  const { data, loading, error } = useDlmmBins(pool);
  if (loading)
    return (
      <div className="space-y-2 p-4" role="status" aria-label="Loading DLMM bins">
        <div className="mb-4 flex justify-between gap-4">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    );
  if (error || !data) return <p className="m-4 border border-line p-5 text-sm text-muted">DLMM bin liquidity is temporarily unavailable.</p>;
  const rows = dlmmDepthRows(data.bins, data.activeBin, baseDecimals, quoteDecimals, inverted);
  const fundedBins = rows.filter((row) => row.funded).length;
  const maxTotal = Math.max(1, ...rows.map((row) => row.cumulative));

  if (mode === "depth")
    return (
      <section className="min-h-80 p-4" aria-label={`${base}/${quote} cumulative depth`}>
        <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase text-muted">
          <span>Cumulative DLMM depth · {fundedBins}/{rows.length} funded</span><span>Active bin {data.activeBin}</span>
        </div>
        <div className="space-y-1">
          {rows.map((row) => (
            <div key={row.binId} className="relative grid min-h-7 grid-cols-[4rem_1fr_5rem] items-center gap-2 overflow-hidden px-2 font-mono text-[10px]">
              <span
                className={`absolute inset-y-0 ${row.side === "bid" ? "right-1/2 bg-emerald-400/10" : row.side === "ask" ? "left-1/2 bg-rose-400/10" : "inset-x-0 bg-lime/10"}`}
                style={{ width: row.side === "active" ? "100%" : `${Math.max(2, (row.cumulative / maxTotal) * 50)}%` }}
              />
              <span className={row.side === "bid" ? "text-emerald-300" : row.side === "ask" ? "text-rose-300" : "text-lime"}>{row.binId}</span>
              <span className="relative text-center">{formatNumber(row.price)}</span>
              <span className="relative text-right text-muted">{formatNumber(row.cumulative)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-faint">Cumulative value is derived from finalized reserves in each indexed bin and displayed in {quote} units. Empty levels are retained to show the live range.</p>
      </section>
    );

  return (
    <section className="min-h-80 overflow-x-auto p-4" aria-label={`${base}/${quote} DLMM bin book`} tabIndex={0}>
      <table className="w-full min-w-[34rem] border-collapse text-left font-mono text-[10px]">
        <caption className="mb-3 text-left uppercase text-muted">DLMM bin book · active {data.activeBin} · {fundedBins}/{rows.length} funded</caption>
        <thead className="border-y border-line text-faint"><tr><th className="p-2">Side</th><th className="p-2">Bin</th><th className="p-2 text-right">Price ({quote})</th><th className="p-2 text-right">Amount ({base})</th><th className="p-2 text-right">Quote</th><th className="p-2 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => <tr key={row.binId} className={row.side === "active" ? "bg-lime/5" : ""}>
            <td className={`p-2 uppercase ${row.side === "bid" ? "text-emerald-300" : row.side === "ask" ? "text-rose-300" : "text-lime"}`}>{row.side}</td>
            <td className="p-2">{row.binId}</td><td className="p-2 text-right">{formatNumber(row.price)}</td><td className="p-2 text-right">{row.funded ? formatNumber(row.base) : "—"}</td><td className="p-2 text-right">{row.funded ? formatNumber(row.quote) : "—"}</td><td className="p-2 text-right">{formatNumber(row.cumulative)}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
  );
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.000001 || Math.abs(value) >= 1_000_000) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 12, maximumSignificantDigits: 10 });
}
