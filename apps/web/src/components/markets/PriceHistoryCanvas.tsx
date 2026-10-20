"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2 } from "lucide-react";
import {
  formatChartPrice,
  type ChartStyle,
  type MarketCandle,
} from "@/lib/market-chart-data";

export function PriceHistoryCanvas({
  bars,
  style,
  label,
}: {
  bars: readonly MarketCandle[];
  style: ChartStyle;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Line"> | ISeriesApi<"Candlestick"> | null
  >(null);
  const fitted = useRef(false);
  const [hover, setHover] = useState<MarketCandle | null>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;
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
        vertLines: { color: "#ffffff08" },
        horzLines: { color: "#ffffff08" },
      },
      rightPriceScale: { borderColor: "#252635" },
      timeScale: {
        borderColor: "#252635",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
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
        : chart.addSeries(LineSeries, {
            color: "#dfe2ed",
            lineWidth: 2,
            pointMarkersVisible: true,
            priceFormat,
          });
    chartRef.current = chart;
    seriesRef.current = series;
    fitted.current = false;
    chart.subscribeCrosshairMove((event) => {
      const time =
        typeof event.time === "number" && event.point ? event.time : null;
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
    };
  }, [style]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (style === "candles")
      (series as ISeriesApi<"Candlestick">).setData(
        bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
      );
    else
      (series as ISeriesApi<"Line">).setData(
        bars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.close,
        })),
      );
    if (!fitted.current && bars.length) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [bars, style]);
  const observation = hover ?? bars.at(-1);
  return (
    <div className="flex min-h-80 flex-1 flex-col">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted">
        <p aria-live="off">
          {observation
            ? `O ${formatChartPrice(observation.open)} · H ${formatChartPrice(observation.high)} · L ${formatChartPrice(observation.low)} · C ${formatChartPrice(observation.close)} · ${observation.observations} observations`
            : "No observations"}
        </p>
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
      <div
        ref={host}
        role="img"
        aria-label={label}
        className="relative min-h-72 flex-1"
      />
      <p className="mt-2 text-[9px] text-faint">
        OHLC from recorded observations · drag to pan, scroll to zoom · times in
        UTC.
      </p>
      <a
        href="https://www.tradingview.com/"
        target="_blank"
        rel="noreferrer"
        className="mt-1 text-[9px] text-faint"
      >
        TradingView Lightweight Charts™ · Copyright © 2026 TradingView, Inc.
      </a>
    </div>
  );
}
