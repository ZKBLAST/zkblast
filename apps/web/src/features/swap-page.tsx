"use client";

import { LiveSwapPanel } from "../components/protocol/live-swap-panel";
import markets from "../data/markets.json";
import type { PublicConfig, UserProfile } from "../types/application";
import { formatUsd } from "../lib/format";
import { Badge } from "../components/ui/primitives";

export function SwapPage({
  connect,
  profile,
  apiUrl,
  config,
}: Readonly<{
  connect: () => void;
  profile: UserProfile | null;
  apiUrl: string;
  config: PublicConfig | null;
}>) {
  const defaults = markets.swapDefaults;
  const from = defaults.from;
  const to = defaults.to;
  const rate =
    markets.tokens.find((token) => token.symbol === from)?.price ??
    defaults.rate;
  return (
    <main className="page-container trade-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / EXECUTION TERMINAL</span>
          <h1>Trade without friction.</h1>
          <p>
            Verified public AMM quotes and wallet execution for the active
            environment.
          </p>
        </div>
        <Badge>{config?.environment.toUpperCase() ?? "SYNC"}</Badge>
      </div>
      <div className="trade-workspace">
        <section className="chart-panel">
          <div className="chart-heading">
            <div>
              <small>
                {from} / {to}
              </small>
              <strong>{formatUsd(rate)}</strong>
              <span>+2.41%</span>
            </div>
            <div className="timeframe">
              <button>1H</button>
              <button className="active">1D</button>
              <button>1W</button>
              <button>1M</button>
            </div>
          </div>
          <div className="chart-grid">
            <svg
              viewBox="0 0 720 290"
              role="img"
              aria-label="Demo market price chart"
            >
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity=".2" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                className="chart-fill"
                d={`M0,${290 - (markets.candles[0] ?? 0) * 2} ${markets.candles.map((value, index) => `L${index * 31},${290 - value * 2}`).join(" ")} L720,290 L0,290Z`}
              />
              <path
                className="chart-line"
                d={`M0,${290 - (markets.candles[0] ?? 0) * 2} ${markets.candles.map((value, index) => `L${index * 31},${290 - value * 2}`).join(" ")}`}
              />
            </svg>
            <div className="chart-axis">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>NOW</span>
            </div>
          </div>
          <div className="market-stats">
            <div>
              <small>24H HIGH</small>
              <strong>$2,681.04</strong>
            </div>
            <div>
              <small>24H LOW</small>
              <strong>$2,548.92</strong>
            </div>
            <div>
              <small>24H VOLUME</small>
              <strong>$4.91M</strong>
            </div>
            <div>
              <small>POOL LIQUIDITY</small>
              <strong>$12.84M</strong>
            </div>
          </div>
        </section>
        <LiveSwapPanel
          apiUrl={apiUrl}
          config={config}
          profile={profile}
          connect={connect}
        />
      </div>
      <section className="route-panel">
        <small>EXECUTION ROUTE</small>
        <div>
          {markets.route.map((step, index) => (
            <span key={step}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              {step}
              {index < markets.route.length - 1 && <i> to </i>}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
