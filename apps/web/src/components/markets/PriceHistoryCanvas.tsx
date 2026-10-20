"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  AreaSeries,
  LineStyle,
  LineType,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Info, Maximize2 } from "lucide-react";
import { ChartTooltip } from "./ChartTooltip";
import { chartTooltipLeft } from "@/lib/chart-tooltip";
import {
  formatChartPrice,
  type ChartStyle,
  type MarketCandle,
  type MarketVolumeBar,
} from "@/lib/market-chart-data";

export function PriceHistoryCanvas({
  bars,
  style,
  label,
  volumes,
  volumeUnit,
  limited = false,
}: {
  bars: readonly MarketCandle[];
  style: ChartStyle;
  label: string;
  volumes: readonly MarketVolumeBar[];
  volumeUnit: string | null;
  limited?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null
  >(null);
  const fitted = useRef(false);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [hover, setHover] = useState<MarketCandle | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(8);
  const barsRef = useRef(bars);
  barsRef.current = bars;
  const hasVolume = volumes.length > 0;
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a12" },
        textColor: "#9a9bab",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#ffffff08", visible: style === "candles" },
        horzLines: {
          color: style === "line" ? "#1d1e2e" : "#ffffff08",
          style: style === "line" ? LineStyle.Dashed : LineStyle.Solid,
        },
      },
      rightPriceScale: {
        borderColor: "#252635",
        visible: style === "candles",
        scaleMargins:
          style === "line"
            ? { top: 0.05, bottom: 0.05 }
            : { top: 0.2, bottom: 0.1 },
      },
      crosshair: {
        vertLine: { color: "#a3a8c0", style: LineStyle.Solid, width: 1 },
        horzLine: { visible: style === "candles" },
      },
      timeScale: {
        borderColor: "#252635",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: true,
    });
    const priceFormat = {
      type: "custom" as const,
      formatter: formatChartPrice,
      minMove: 0.000000000001,
    };
    const series =
      style === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: "#56d9ad",
            downColor: "#f07b87",
            wickUpColor: "#56d9ad",
            wickDownColor: "#f07b87",
            borderVisible: false,
            priceFormat,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: "#dfe3ee",
            topColor: "rgba(223,227,238,0.22)",
            bottomColor: "rgba(223,227,238,0)",
            lineWidth: 2,
            lineType: LineType.Curved,
            pointMarkersVisible: true,
            pointMarkersRadius: 3,
            crosshairMarkerRadius: 5,
            crosshairMarkerBorderWidth: 2,
            crosshairMarkerBorderColor: "#0c0c15",
            crosshairMarkerBackgroundColor: "#dfe3ee",
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat,
          });
    chartRef.current = chart;
    seriesRef.current = series;
    if (hasVolume) {
      volumeRef.current = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        },
        1,
      );
      chart.panes()[0]?.setStretchFactor(4);
      chart.panes()[1]?.setStretchFactor(1);
    }
    fitted.current = false;
    chart.subscribeCrosshairMove((event) => {
      const time =
        typeof event.time === "number" &&
        event.point &&
        event.point.x >= 0 &&
        event.point.y >= 0 &&
        event.point.x <= (host.current?.clientWidth ?? 0) &&
        event.point.y <= (host.current?.clientHeight ?? 0)
          ? event.time
          : null;
      if (time !== null && event.point)
        setTooltipLeft(
          chartTooltipLeft(event.point.x, host.current?.clientWidth ?? 0),
        );
      setHover(
        time === null
          ? null
          : (barsRef.current.find((bar) => bar.time === time) ?? null),
      );
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [style, hasVolume]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    volumeRef.current?.setData(
      volumes.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
    );
    if (style === "candles")
      (series as ISeriesApi<"Candlestick">).setData(
        bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
      );
    else {
      const area = series as ISeriesApi<"Area">;
      area.setData(
        bars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.close,
        })),
      );
    }
    if (!fitted.current && bars.length) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [bars, volumes, style, hasVolume]);
  const observation = hover ?? bars.at(-1);
  return (
    <div className="flex min-h-80 flex-1 flex-col">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted">
        <p
          aria-live="off"
          className="min-w-0 break-words [overflow-wrap:anywhere]"
        >
          {observation
            ? style === "line"
              ? `${formatChartPrice(observation.close)} ${volumeUnit ?? ""}`
              : `O ${formatChartPrice(observation.open)} · H ${formatChartPrice(observation.high)} · L ${formatChartPrice(observation.low)} · C ${formatChartPrice(observation.close)}`
            : "No observations"}
        </p>
        <div className="flex items-center gap-2">
          {hasVolume && <span>Vol {volumeUnit ?? ""}</span>}
          <details className="relative">
            <summary
              aria-label="Chart information"
              title="Chart information"
              className="cursor-pointer list-none p-2 [&::-webkit-details-marker]:hidden"
            >
              <Info className="size-3.5" aria-hidden />
            </summary>
            <div className="absolute right-0 top-full z-20 w-64 border border-line bg-bg p-3 text-xs leading-relaxed shadow-xl">
              <p>
                Times in UTC. Oracle/reference prices are not executable quotes.
              </p>
              {style === "line" && (
                <p className="mt-2">
                  Curves are visual; dots mark recorded interval closes.
                </p>
              )}
              {limited && (
                <p className="mt-2">
                  Latest 2,000 observations. Choose a shorter period for more
                  detail.
                </p>
              )}
              <a
                href="https://www.tradingview.com/"
                target="_blank"
                rel="noreferrer"
                className="mt-2 block underline"
              >
                TradingView Lightweight Charts™ · Copyright © 2026 TradingView,
                Inc.
              </a>
            </div>
          </details>
          <button
            type="button"
            onClick={() => chartRef.current?.timeScale().fitContent()}
            className="flex items-center gap-1 p-2"
            aria-label="Fit chart to data"
          >
            <Maximize2 className="size-3" aria-hidden />
            Fit
          </button>
        </div>
      </div>
      <div
        className="relative min-h-72 min-w-0 flex-1"
        onPointerLeave={() => setHover(null)}
      >
        <div
          ref={host}
          role="img"
          aria-label={label}
          className="absolute inset-0"
        />
        {hover && (
          <ChartTooltip
            bar={hover}
            style={style}
            unit={volumeUnit}
            volume={volumes.find((item) => item.time === hover.time)?.value}
            left={tooltipLeft}
          />
        )}
      </div>
    </div>
  );
}
