"use client";
import { Layers } from "lucide-react";
import { AccountPanel } from "@/components/account/AccountPanel";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge, PairMark, TypeTag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { useProtocolData } from "@/lib/use-protocol-data";

export function PositionsView() {
  const { address, connect } = useApp(); const data = useProtocolData(address);
  if (!address) return <><PageHeader title="Positions" lead="Validated on-chain positions belonging to your authenticated wallet." badges={<LaneBadge lane="public" />} /><div className="mx-auto max-w-[1360px] px-4 sm:px-6"><div className="panel flex items-start gap-4 p-8"><Layers className="size-5 text-muted" /><div><p className="font-semibold">Connect a wallet to query your positions</p><p className="mt-1 text-sm text-muted">No demo account or placeholder position is loaded.</p><Button className="mt-4" onClick={connect}>Connect wallet</Button></div></div></div></>;
  return <><PageHeader title="Positions" lead="Positions are filtered by the authenticated wallet and read from validated testnet records." badges={<LaneBadge lane="public" />} aside={<dl className="grid grid-cols-2 gap-6"><Stat label="Indexed positions" value={data.positions.length} /><Stat label="Open" value={data.positions.filter((item) => item.status === "open").length} /></dl>} /><div className="mx-auto max-w-[1360px] px-4 sm:px-6"><AccountPanel /><RealDataState loading={data.loading} error={data.error} empty={!data.positions.length} onRetry={data.refresh} />{!!data.positions.length && <ul className="space-y-3">{data.positions.map((position) => <li key={`${position.poolAddress}:${position.onchainPositionId}`} className="panel ticks grid gap-4 p-5 md:grid-cols-[1fr_auto_auto] md:items-center"><span className="flex items-center gap-3"><PairMark base={position.token0Symbol} quote={position.token1Symbol} /><span><strong>{position.token0Symbol}/{position.token1Symbol}</strong><span className="mt-1 block font-mono text-xs text-faint">Position {position.onchainPositionId}</span></span></span><TypeTag type={position.model.toUpperCase() as "DAMM" | "DLMM"} /><dl className="text-right"><dt className="text-xs text-faint">Raw liquidity</dt><dd className="num">{position.liquidityRaw}</dd><dd className="mt-1 font-mono text-xs uppercase text-muted">{position.status}</dd></dl></li>)}</ul>}</div></>;
}
