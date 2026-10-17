"use client";

import markets from "../../data/markets.json";
import { AppLink, Badge } from "../ui/primitives";

export function PoolTable({
  compact = false,
}: Readonly<{ compact?: boolean }>) {
  return (
    <div className="data-table">
      <div className="data-row data-head">
        <span>POOL</span>
        <span>MODEL / FEE</span>
        <span>TVL</span>
        <span>24H VOLUME</span>
        <span>APR</span>
        <span>STATE</span>
      </div>
      {markets.pools.slice(0, compact ? 3 : undefined).map((pool) => (
        <AppLink className="data-row" href={`/pools/${pool.id}`} key={pool.id}>
          <span>
            <b>{pool.pair}</b>
            <small>{pool.range}</small>
          </span>
          <span>
            <b>{pool.type}</b>
            <small>{pool.fee}</small>
          </span>
          <span>{pool.tvl}</span>
          <span>{pool.volume24h}</span>
          <span className="positive">{pool.apr}</span>
          <span>
            <Badge muted>{pool.state}</Badge>
          </span>
        </AppLink>
      ))}
    </div>
  );
}
