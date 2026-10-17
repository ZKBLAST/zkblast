"use client";

import markets from "../data/markets.json";
import { MetricStrip } from "../components/protocol/metric-strip";
import { PoolTable } from "../components/protocol/pool-table";
import { AppLink, Badge, Panel } from "../components/ui/primitives";
import { LiveLiquidityPanel } from "../components/protocol/live-liquidity-panel";
import type { PublicConfig, UserProfile } from "../types/application";

export function PoolsPage({
  poolId,
  apiUrl,
  config,
  profile,
  connect,
}: Readonly<{
  poolId?: string | undefined;
  apiUrl: string;
  config: PublicConfig | null;
  profile: UserProfile | null;
  connect: () => void;
}>) {
  const pool = markets.pools.find((item) => item.id === poolId);
  if (pool)
    return (
      <main className="page-container">
        <AppLink href="/pools" className="back-link">
          ← ALL POOLS
        </AppLink>
        <div className="page-heading">
          <div>
            <span className="eyebrow">POOL / {pool.type}</span>
            <h1>{pool.pair}</h1>
            <p>
              Liquidity position workflow preview using environment-bound
              deployment metadata.
            </p>
          </div>
          <Badge>{pool.state}</Badge>
        </div>
        <MetricStrip />
        <div className="pool-detail-grid">
          <Panel>
            <div className="panel-title">
              <h2>Liquidity distribution</h2>
              <span>{pool.range}</span>
            </div>
            <div className="liquidity-bars">
              {[30, 48, 61, 72, 86, 95, 89, 76, 64, 51, 38, 26].map(
                (height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ),
              )}
            </div>
            <div className="range-axis">
              <span>MIN PRICE</span>
              <b>ACTIVE BIN</b>
              <span>MAX PRICE</span>
            </div>
          </Panel>
          <Panel>
            <div className="panel-title">
              <h2>Pool state</h2>
              <Badge muted>DEMO</Badge>
            </div>
            <dl className="detail-list">
              <div>
                <dt>TVL</dt>
                <dd>{pool.tvl}</dd>
              </div>
              <div>
                <dt>24H volume</dt>
                <dd>{pool.volume24h}</dd>
              </div>
              <div>
                <dt>24H fees</dt>
                <dd>{pool.fees24h}</dd>
              </div>
              <div>
                <dt>Estimated APR</dt>
                <dd>{pool.apr}</dd>
              </div>
              <div>
                <dt>Fee tier</dt>
                <dd>{pool.fee}</dd>
              </div>
            </dl>
          </Panel>
          <Panel className="position-builder">
            <div className="panel-title">
              <h2>New position</h2>
            </div>
            <div className="segmented">
              <button className="active">CONCENTRATED</button>
              <button>FULL RANGE</button>
            </div>
            <label>
              PRICE RANGE
              <div className="dual-input">
                <input defaultValue="2180" />
                <input defaultValue="3120" />
              </div>
            </label>
            <label>
              DEPOSIT AMOUNT
              <div className="dual-input">
                <input defaultValue="1.00 ETH" />
                <input defaultValue="2634.82 USDC" />
              </div>
            </label>
            <button className="button button-primary full-width">
              CONNECT TO CREATE POSITION
            </button>
            <p className="entry-disclaimer">
              No transaction will be generated before verified contracts are
              available.
            </p>
          </Panel>
        </div>
      </main>
    );
  return (
    <main className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / LIQUIDITY DIRECTORY</span>
          <h1>Deploy capital precisely.</h1>
          <p>
            Compare execution models, fee tiers and representative liquidity
            ranges.
          </p>
        </div>
        <Badge>DEMO DATA</Badge>
      </div>
      <div className="filter-bar">
        <button className="active">ALL POOLS</button>
        <button>DLMM</button>
        <button>DAMM</button>
        <span />
        <input placeholder="SEARCH PAIR" />
      </div>
      <PoolTable />
      <LiveLiquidityPanel
        apiUrl={apiUrl}
        config={config}
        profile={profile}
        connect={connect}
      />
      <div className="disclosure">
        All market values on this screen come from local JSON interface
        fixtures. They are not claims of deployed liquidity or protocol
        performance.
      </div>
    </main>
  );
}
