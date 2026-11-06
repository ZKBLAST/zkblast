"use client";

import { useEffect, useState } from "react";

import type { ChartInterval, ChartStyle } from "./market-chart-data";

type ChartPreferences = Readonly<{
  interval: ChartInterval;
  style: ChartStyle | null;
}>;
const defaults: ChartPreferences = { interval: "1h", style: null };
const intervals = new Set<ChartInterval>(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

export function useChartPreferences() {
  const [preferences, setPreferences] = useState<ChartPreferences>(defaults);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("zkblast.chart.preferences.v2");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ChartPreferences>;
      setPreferences({
        interval: parsed.interval && intervals.has(parsed.interval) ? parsed.interval : defaults.interval,
        style: parsed.style === "line" || parsed.style === "candles" ? parsed.style : null,
      });
    } catch {
      /* Storage can be unavailable in privacy-restricted browser contexts. */
    }
  }, []);
  const update = (next: Partial<ChartPreferences>) => {
    setPreferences((current) => {
      const value = { ...current, ...next };
      try {
        window.localStorage.setItem("zkblast.chart.preferences.v2", JSON.stringify(value));
      } catch {
        /* Preferences are optional and never block chart rendering. */
      }
      return value;
    });
  };
  return { preferences, update };
}
