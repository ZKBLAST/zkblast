"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  AreaSeries,
  LineSeries,
  LineStyle,
  LineType,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Info, Maximize2 } from "lucide-react";
import { ChartTooltip } from "./ChartTooltip";
import { chartTooltipLeft } from "@/lib/chart-tooltip";
import type { ChartIndicator } from "@/lib/use-chart-preferences";
import type { DlmmBins } from "@/lib/use-dlmm-bins";
import {
  dlmmRangeEvent,
  isDlmmRangeEvent,
  publishDlmmRange,
} from "@/lib/dlmm-range-events";
import {
  DlmmLiquidityOverlay,
  type PositionedLiquidityBin,
} from "./DlmmLiquidityOverlay";
import {
  formatChartPrice,
  type ChartStyle,
  type MarketCandle,
  type MarketVolumeBar,
  type ChartPositionLine,
} from "@/lib/market-chart-data";

export function PriceHistoryCanvas({
  bars,
  style,
  label,
  volumes,
  volumeUnit,
  limited = false,
  positionLines = [],
  indicators = [],
  liquidityBins = null,
  liquidityInverted = false,
  walletLiquidityBins = [],
}: {
  bars: readonly MarketCandle[];
  style: ChartStyle;
  label: string;
  volumes: readonly MarketVolumeBar[];
  volumeUnit: string | null;
  limited?: boolean;
  positionLines?: readonly ChartPositionLine[];
  indicators?: readonly ChartIndicator[];
  liquidityBins?: DlmmBins | null;
  liquidityInverted?: boolean;
  walletLiquidityBins?: readonly number[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null
  >(null);
  const fitted = useRef(false);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const positionLineRefs = useRef<IPriceLine[]>([]);
  const indicatorSeriesRefs = useRef<ISeriesApi<"Line">[]>([]);
  const [hover, setHover] = useState<MarketCandle | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(8);
  const [positionedBins, setPositionedBins] = useState<readonly PositionedLiquidityBin[]>([]);
  const [rangeBins, setRangeBins] = useState<Readonly<{ lower: number; upper: number }> | null>(null);
  const draggingBound = useRef<"lower" | "upper" | null>(null);
  const barsRef = useRef(bars);
  const renderedBarsRef = useRef<readonly MarketCandle[]>([]);
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
      localization: {
        timeFormatter: (time: Time) =>
          new Date(
            typeof time === "number"
              ? time * 1_000
              : typeof time === "string"
                ? time
              : Date.UTC(time.year, time.month - 1, time.day),
          ).toLocaleString(undefined, {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
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
            ? { top: 0.05, bottom: hasVolume ? 0.22 : 0.05 }
            : { top: 0.12, bottom: hasVolume ? 0.24 : 0.1 },
      },
      crosshair: {
        vertLine: { color: "#a3a8c0", style: LineStyle.Solid, width: 1 },
        horzLine: { visible: style === "candles" },
      },
      timeScale: {
        borderColor: "#252635",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
        minBarSpacing: 3,
        rightOffset: 4,
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
            priceLineVisible: true,
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true,
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
            priceLineVisible: true,
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true,
            priceFormat,
          });
    chartRef.current = chart;
    seriesRef.current = series;
    renderedBarsRef.current = [];
    if (hasVolume) {
      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volumeRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
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
      renderedBarsRef.current = [];
      volumeRef.current = null;
      positionLineRefs.current = [];
      indicatorSeriesRefs.current = [];
    };
  }, [style, hasVolume]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const previous = renderedBarsRef.current;
    const unchangedPrefix = previous.length > 0 && bars.length >= previous.length &&
      previous.slice(0, -1).every((bar, index) => sameCandle(bar, bars[index]));
    if (unchangedPrefix) {
      for (const bar of bars.slice(previous.length - 1)) {
        if (style === "candles")
          (series as ISeriesApi<"Candlestick">).update({
            ...bar,
            time: bar.time as UTCTimestamp,
          });
        else
          (series as ISeriesApi<"Area">).update({
            time: bar.time as UTCTimestamp,
            value: bar.close,
          });
        const volume = volumes.find((item) => item.time === bar.time);
        if (volume)
          volumeRef.current?.update({
            ...volume,
            time: volume.time as UTCTimestamp,
          });
      }
    } else {
      volumeRef.current?.setData(
        volumes.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
      );
      if (style === "candles")
        (series as ISeriesApi<"Candlestick">).setData(
          bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })),
        );
      else
        (series as ISeriesApi<"Area">).setData(
          bars.map((bar) => ({
            time: bar.time as UTCTimestamp,
            value: bar.close,
          })),
        );
    }
    renderedBarsRef.current = bars;
    if (!fitted.current && bars.length) {
      const visible = Math.min(80, bars.length);
      chartRef.current?.timeScale().setVisibleLogicalRange(
        bars.length <= 2
          ? { from: -20, to: 5 }
          : { from: bars.length - visible - 0.5, to: bars.length + 3 },
      );
      fitted.current = true;
    }
  }, [bars, volumes, style, hasVolume]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of positionLineRefs.current) series.removePriceLine(line);
    positionLineRefs.current = positionLines
      .filter((line) => Number.isFinite(line.price) && line.price > 0)
      .map((line) => series.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.label,
      }));
  }, [positionLines, style]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const indicatorSeries of indicatorSeriesRefs.current)
      chart.removeSeries(indicatorSeries);
    indicatorSeriesRefs.current = [];
    const addIndicator = (data: readonly IndicatorPoint[], color: string, title: string) => {
      if (!data.length) return;
      const indicatorSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title,
      });
      indicatorSeries.setData(data.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.value,
      })));
      indicatorSeriesRefs.current.push(indicatorSeries);
    };
    if (indicators.includes("ma20")) addIndicator(movingAverage(bars, 20), "#8ab4f8", "MA 20");
    if (indicators.includes("ema50")) addIndicator(exponentialAverage(bars, 50), "#f6c177", "EMA 50");
    if (indicators.includes("vwap")) addIndicator(sessionVwap(bars, volumes), "#56d9ad", "VWAP");
    if (indicators.includes("bb20")) {
      const bands = bollingerBands(bars, 20, 2);
      addIndicator(bands.upper, "#c4a7e7", "BB upper");
      addIndicator(bands.lower, "#c4a7e7", "BB lower");
    }
    return () => {
      for (const indicatorSeries of indicatorSeriesRefs.current) {
        try { chart.removeSeries(indicatorSeries); } catch { /* chart can already be disposed */ }
      }
      indicatorSeriesRefs.current = [];
    };
  }, [bars, indicators, volumes, style]);
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const element = host.current;
    if (!series || !chart || !element || !liquidityBins?.bins.length) {
      setPositionedBins([]);
      setRangeBins(null);
      return;
    }
    const ordered = [...liquidityBins.bins]
      .map((bin) => {
        const direct = Number(BigInt(bin.priceX18)) / 1e18;
        return { ...bin, price: liquidityInverted && direct > 0 ? 1 / direct : direct };
      })
      .filter((bin) => Number.isFinite(bin.price) && bin.price > 0)
      .sort((left, right) => left.binId - right.binId);
    setRangeBins((current) => current ?? {
      lower: ordered.find((bin) => bin.binId === liquidityBins.activeBin - 2)?.binId ?? ordered[0]!.binId,
      upper: ordered.find((bin) => bin.binId === liquidityBins.activeBin + 2)?.binId ?? ordered.at(-1)!.binId,
    });
    const redraw = () => {
      const owned = new Set(walletLiquidityBins);
      const magnitudes = ordered.map((bin) => liquidityMagnitude(bin.totalShares));
      const maximum = Math.max(1, ...magnitudes);
      setPositionedBins(ordered.flatMap((bin, index) => {
        const coordinate = series.priceToCoordinate(bin.price);
        if (coordinate === null || coordinate < 0 || coordinate > element.clientHeight) return [];
        return [{
          binId: bin.binId,
          top: coordinate,
          width: 4 + (magnitudes[index]! / maximum) * 31,
          side: bin.binId === liquidityBins.activeBin
            ? "active" as const
            : bin.binId > liquidityBins.activeBin
              ? "base" as const
              : "quote" as const,
          totalShares: bin.totalShares,
          price: bin.price,
          owned: owned.has(bin.binId),
        }];
      }));
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(element);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
    };
  }, [bars, liquidityBins, liquidityInverted, style, walletLiquidityBins]);

  useEffect(() => {
    function move(event: PointerEvent) {
      if (!draggingBound.current || !host.current || !seriesRef.current || !liquidityBins?.bins.length) return;
      const coordinate = event.clientY - host.current.getBoundingClientRect().top;
      const price = seriesRef.current.coordinateToPrice(coordinate);
      if (price === null) return;
      const nearest = [...liquidityBins.bins].reduce((best, bin) => {
        const direct = Number(BigInt(bin.priceX18)) / 1e18;
        const candidate = liquidityInverted && direct > 0 ? 1 / direct : direct;
        return Math.abs(candidate - price) < best.distance
          ? { binId: bin.binId, distance: Math.abs(candidate - price) }
          : best;
      }, { binId: liquidityBins.activeBin, distance: Number.POSITIVE_INFINITY });
      setRangeBins((current) => {
        const previous = current ?? { lower: nearest.binId, upper: nearest.binId };
        return draggingBound.current === "lower"
          ? { lower: Math.min(nearest.binId, previous.upper), upper: previous.upper }
          : { lower: previous.lower, upper: Math.max(nearest.binId, previous.lower) };
      });
    }
    function stop() { draggingBound.current = null; }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [liquidityBins, liquidityInverted]);
  useEffect(() => {
    if (!liquidityBins || !rangeBins) return;
    publishDlmmRange({
      pool: liquidityBins.pool.toLowerCase(),
      lower: rangeBins.lower,
      upper: rangeBins.upper,
      source: "chart",
    });
  }, [liquidityBins, rangeBins]);
  useEffect(() => {
    if (!liquidityBins) return;
    const pool = liquidityBins.pool.toLowerCase();
    function receive(event: Event) {
      if (!isDlmmRangeEvent(event) || event.detail.source !== "form" || event.detail.pool !== pool) return;
      setRangeBins({ lower: event.detail.lower, upper: event.detail.upper });
    }
    window.addEventListener(dlmmRangeEvent, receive);
    return () => window.removeEventListener(dlmmRangeEvent, receive);
  }, [liquidityBins]);
  const observation = hover ?? bars.at(-1);
  const observationIndex = observation
    ? bars.findIndex((bar) => bar.time === observation.time)
    : -1;
  const previous = observationIndex > 0 ? bars[observationIndex - 1] : null;
  const change = observation && previous && previous.close > 0
    ? ((observation.close - previous.close) / previous.close) * 100
    : null;
  function handleChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale) return;
    if (event.key === "Home") {
      event.preventDefault();
      timeScale.fitContent();
      return;
    }
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const width = range.to - range.from;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const offset = width * 0.1 * (event.key === "ArrowLeft" ? -1 : 1);
      timeScale.setVisibleLogicalRange({
        from: range.from + offset,
        to: range.to + offset,
      });
      return;
    }
    if (["+", "=", "-", "_"].includes(event.key)) {
      event.preventDefault();
      const center = (range.from + range.to) / 2;
      const zoom = event.key === "+" || event.key === "=" ? 0.8 : 1.25;
      const half = (width * zoom) / 2;
      timeScale.setVisibleLogicalRange({ from: center - half, to: center + half });
    }
  }
  return (
    <div className="flex min-h-64 flex-1 flex-col sm:min-h-80">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted">
        <p
          aria-live="off"
          className="min-w-0 break-words [overflow-wrap:anywhere]"
        >
          {observation
            ? style === "line"
              ? `${formatChartPrice(observation.close)} ${volumeUnit ?? ""}${change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}`
              : `O ${formatChartPrice(observation.open)} · H ${formatChartPrice(observation.high)} · L ${formatChartPrice(observation.low)} · C ${formatChartPrice(observation.close)}${change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}`
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
        className="relative min-h-56 min-w-0 flex-1 sm:min-h-72"
        onPointerLeave={() => setHover(null)}
      >
        <div
          ref={host}
          role="img"
          tabIndex={0}
          aria-label={`${label}. Use left and right arrows to pan, plus and minus to zoom, and Home to fit all data.`}
          onKeyDown={handleChartKeyDown}
          className="absolute inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-lime"
        />
        {liquidityBins && rangeBins ? (
          <DlmmLiquidityOverlay
            bins={positionedBins}
            activeBin={liquidityBins.activeBin}
            lowerBin={rangeBins.lower}
            upperBin={rangeBins.upper}
            onDragStart={(bound, event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingBound.current = bound;
            }}
          />
        ) : null}
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

type IndicatorPoint = Readonly<{ time: number; value: number }>;

function movingAverage(bars: readonly MarketCandle[], period: number): IndicatorPoint[] {
  return bars.flatMap((bar, index) => {
    if (index + 1 < period) return [];
    const window = bars.slice(index + 1 - period, index + 1);
    return [{ time: bar.time, value: window.reduce((sum, item) => sum + item.close, 0) / period }];
  });
}

function exponentialAverage(bars: readonly MarketCandle[], period: number): IndicatorPoint[] {
  if (!bars.length) return [];
  const multiplier = 2 / (period + 1);
  let value = bars[0].close;
  return bars.map((bar) => {
    value = bar.close * multiplier + value * (1 - multiplier);
    return { time: bar.time, value };
  });
}

function sessionVwap(
  bars: readonly MarketCandle[],
  volumes: readonly MarketVolumeBar[],
): IndicatorPoint[] {
  const volumeByTime = new Map(volumes.map((item) => [item.time, item.value]));
  let totalValue = 0;
  let totalVolume = 0;
  return bars.flatMap((bar) => {
    const volume = volumeByTime.get(bar.time) ?? 0;
    if (volume <= 0) return [];
    totalValue += ((bar.high + bar.low + bar.close) / 3) * volume;
    totalVolume += volume;
    return [{ time: bar.time, value: totalValue / totalVolume }];
  });
}

function bollingerBands(bars: readonly MarketCandle[], period: number, deviations: number) {
  const upper: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index + 1 - period, index + 1);
    const average = window.reduce((sum, item) => sum + item.close, 0) / period;
    const variance = window.reduce((sum, item) => sum + (item.close - average) ** 2, 0) / period;
    const distance = Math.sqrt(variance) * deviations;
    upper.push({ time: bars[index].time, value: average + distance });
    lower.push({ time: bars[index].time, value: average - distance });
  }
  return { upper, lower };
}

function sameCandle(left: MarketCandle, right: MarketCandle | undefined) {
  return Boolean(right) && left.time === right!.time && left.open === right!.open &&
    left.high === right!.high && left.low === right!.low && left.close === right!.close;
}

function liquidityMagnitude(raw: string) {
  if (!/^\d+$/u.test(raw) || raw === "0") return 0;
  return Math.log10(Number(raw.slice(0, 15))) + Math.max(0, raw.length - 15);
}
