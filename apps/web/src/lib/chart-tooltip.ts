import type { ChartStyle, MarketCandle } from "./market-chart-data";

export function chartTooltipValues(bar: MarketCandle, style: ChartStyle) {
  return style === "candles"
    ? ([
        ["Open", bar.open],
        ["High", bar.high],
        ["Low", bar.low],
        ["Close", bar.close],
      ] as const)
    : ([["Price", bar.close]] as const);
}

export function chartTooltipLeft(pointerX: number, chartWidth: number) {
  return Math.max(8, Math.min(pointerX + 12, chartWidth - 200));
}
