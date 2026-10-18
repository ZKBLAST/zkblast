"use client";
import { ExternalLink } from "lucide-react";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge, PairMark, TypeTag } from "@/components/ui/Badges";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { useProtocolData } from "@/lib/use-protocol-data";

export function PoolsView() {
  const { config } = useApp(); const data = useProtocolData();
  return <><PageHeader title="Pools" lead="Pools verified from finalized testnet events. Values not derivable from indexed contracts are intentionally omitted." badges={<LaneBadge lane="public" />} aside={<dl className="grid grid-cols-2 gap-6"><Stat label="Validated pools" value={data.pools.length} /><Stat label="Indexer lag" value={data.metrics?.lag ?? "Unavailable"} /></dl>} /><div className="mx-auto max-w-[1360px] px-4 sm:px-6"><RealDataState loading={data.loading} error={data.error} empty={!data.pools.length} onRetry={data.refresh} />{!!data.pools.length && <ul className="divide-y divide-line border-y border-line">{data.pools.map((pool) => <li key={pool.address} className="grid gap-4 py-5 md:grid-cols-[1fr_auto_auto_auto] md:items-center"><span className="flex items-center gap-3"><PairMark base={pool.token0Symbol} quote={pool.token1Symbol} /><span><strong>{pool.token0Symbol}/{pool.token1Symbol}</strong><span className="mt-1 block font-mono text-xs text-faint">{pool.address}</span></span></span><TypeTag type={pool.model.toUpperCase() as "DAMM" | "DLMM"} /><span className="font-mono text-sm">{pool.feeBps} bps</span>{config && <a href={`${config.explorerUrl.replace(/\/$/u, "")}/address/${pool.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-lime">Contract <ExternalLink className="size-3" /></a>}</li>)}</ul>}</div></>;
}
