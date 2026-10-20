import {
  formatChartPrice,
  type ChartStyle,
  type MarketCandle,
} from "@/lib/market-chart-data";
import { chartTooltipValues } from "@/lib/chart-tooltip";

export function ChartTooltip({
  bar,
  style,
  unit,
  volume,
  left,
}: {
  bar: MarketCandle;
  style: ChartStyle;
  unit: string | null;
  volume?: number;
  left: number;
}) {
  const values = chartTooltipValues(bar, style);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-2 z-20 w-48 max-w-[calc(100%_-_1rem)] border border-line-strong bg-bg/95 p-3 text-xs shadow-xl"
      style={{ left }}
    >
      <p className="mb-2 font-mono text-[10px] text-muted">
        {new Date(bar.time * 1000).toISOString().replace("T", " ").slice(0, 16)}{" "}
        UTC
      </p>
      <dl className="space-y-1.5">
        {values.map(([name, value]) => (
          <div key={name} className="flex flex-wrap justify-between gap-x-2">
            <dt className="text-muted">{name}</dt>
            <dd className="break-all font-mono">
              {formatChartPrice(value)} {unit}
            </dd>
          </div>
        ))}
        {volume !== undefined && (
          <div className="flex flex-wrap justify-between gap-x-2 border-t border-line pt-2">
            <dt className="text-muted">Volume</dt>
            <dd className="break-all font-mono">
              {formatChartPrice(volume)} {unit}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
