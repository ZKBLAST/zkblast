"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type { TradePanel } from "@/lib/trade-instruments";

type Position = Readonly<{
  positionId: string;
  marketId: string;
  isLong: boolean;
  marginRaw: string;
  notionalRaw: string;
  status: "open" | "closed" | "liquidated";
}>;

type Market = Readonly<{ marketId: string; symbol: string }>;
type Activity = Readonly<{
  transactionHash: string;
  logIndex: number;
  blockNumber: string;
  blockTimestamp: string;
  eventKind: string;
  marketId: string | null;
}>;

function usd(raw: string): string {
  return `${(Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDG`;
}

export function PerpsAccountWorkspace({
  panel,
  revision,
  privatePositionLines = [],
}: Readonly<{
  panel: TradePanel;
  revision: number;
  privatePositionLines?: readonly (Readonly<{ id: string; marketId: string; label: string; color: string; price: number }>)[];
}>) {
  const { address, injectedAddress, config } = useApp();
  const wallet = injectedAddress ?? address;
  const [positions, setPositions] = useState<readonly Position[]>([]);
  const [markets, setMarkets] = useState<readonly Market[]>([]);
  const [activity, setActivity] = useState<readonly Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (!wallet) {
      setPositions([]);
      setActivity([]);
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void Promise.all([
      apiRequest<{ items: Position[] }>(
        webPublicConfig.apiUrl,
        `/v1/perps/positions?ownerAddress=${encodeURIComponent(wallet)}`,
        { signal: controller.signal },
      ),
      apiRequest<{ items: Market[] }>(webPublicConfig.apiUrl, "/v1/perps/markets", {
        signal: controller.signal,
      }),
      apiRequest<{ items: Activity[] }>(
        webPublicConfig.apiUrl,
        `/v1/perps/activity?ownerAddress=${encodeURIComponent(wallet)}&limit=50`,
        { signal: controller.signal },
      ),
    ])
      .then(([positionResponse, marketResponse, activityResponse]) => {
        setPositions(positionResponse.items);
        setMarkets(marketResponse.items);
        setActivity(activityResponse.items);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "PERPS_ACCOUNT_UNAVAILABLE");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, wallet]);

  if (!wallet) return <p className="p-5 text-sm text-muted">Connect a wallet to view Perps positions and activity.</p>;
  if (loading) return <div className="m-5 h-24 animate-pulse bg-raised" aria-label="Loading Perps account" />;
  if (error) return <p className="p-5 text-sm text-danger">Perps account data unavailable · {error}</p>;

  const visiblePositions = positions.filter((position) =>
    panel === "positions" ? position.status === "open" : position.status !== "open",
  );
  if (panel !== "activity") {
    const visiblePrivatePositions = panel === "positions" ? privatePositionLines : [];
    return visiblePositions.length === 0 && visiblePrivatePositions.length === 0 ? (
      <p className="p-5 text-sm text-muted">No {panel === "positions" ? "open" : "closed"} Perps positions for this wallet.</p>
    ) : (
      <div className="divide-y divide-line">
        {visiblePrivatePositions.map((position) => (
          <article key={position.id} className="grid gap-3 p-5 font-mono text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div>
              <p>{markets.find((market) => market.marketId === position.marketId)?.symbol ?? "Shielded perpetual"}</p>
              <p className="mt-1" style={{ color: position.color }}>{position.label}</p>
            </div>
            <div className="sm:text-right"><p>Entry {position.price.toLocaleString(undefined, { maximumFractionDigits: 8 })} USD</p><p className="mt-1 text-muted">Private ownership</p></div>
            <span className="w-fit border border-line px-2 py-1 uppercase text-muted">open · shielded</span>
          </article>
        ))}
        {visiblePositions.map((position) => (
          <article key={position.positionId} className="grid gap-3 p-5 font-mono text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div>
              <p>{markets.find((market) => market.marketId === position.marketId)?.symbol ?? "Perpetual"}</p>
              <p className={position.isLong ? "mt-1 text-lime" : "mt-1 text-danger"}>{position.isLong ? "Long" : "Short"}</p>
            </div>
            <div className="sm:text-right"><p>{usd(position.marginRaw)} margin</p><p className="mt-1 text-muted">{usd(position.notionalRaw)} size</p></div>
            <span className="w-fit border border-line px-2 py-1 uppercase text-muted">{position.status}</span>
          </article>
        ))}
      </div>
    );
  }

  return activity.length === 0 ? (
    <p className="p-5 text-sm text-muted">No indexed Perps activity for this wallet.</p>
  ) : (
    <div className="divide-y divide-line">
      {activity.map((item) => (
        <a
          key={`${item.transactionHash}:${item.logIndex}`}
          href={`${config?.explorerUrl ?? ""}/tx/${item.transactionHash}`}
          target="_blank"
          rel="noreferrer"
          className="grid gap-2 p-5 font-mono text-xs hover:bg-raised sm:grid-cols-[1fr_auto_auto] sm:items-center"
        >
          <span className="uppercase">{item.eventKind.replaceAll("_", " ")}</span>
          <span className="text-muted">Block {item.blockNumber}</span>
          <time className="text-muted">{new Date(item.blockTimestamp).toLocaleString()}</time>
        </a>
      ))}
    </div>
  );
}
