"use client";
import { ExternalLink } from "lucide-react";
import { RealDataState } from "@/components/protocol/real-data-state";
import { useApp } from "@/components/shell/AppProvider";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { useProtocolData } from "@/lib/use-protocol-data";

export function AnalyticsView() {
  const { config } = useApp(); const data = useProtocolData();
  return <><PageHeader title="Analytics" lead="Counts and events from the testnet indexer. USD estimates, synthetic charts, and invented APR values are not displayed." aside={<dl className="grid grid-cols-3 gap-6"><Stat label="Pools" value={data.pools.length} /><Stat label="Swaps indexed" value={data.swaps.length} /><Stat label="Lag blocks" value={data.metrics?.lag ?? "Unavailable"} /></dl>} /><div className="mx-auto max-w-[1360px] px-4 sm:px-6"><RealDataState loading={data.loading} error={data.error} empty={!data.swaps.length && !data.pools.length} onRetry={data.refresh} /><h2 className="display mt-10 text-3xl">Finalized swap events</h2>{!!data.swaps.length && <table className="mt-5 w-full text-left text-sm"><thead className="border-y border-line font-mono text-xs uppercase text-faint"><tr><th className="py-3">Block</th><th>Input raw</th><th>Output raw</th><th>Receipt</th></tr></thead><tbody>{data.swaps.map((swap) => <tr key={`${swap.transaction_hash}:${swap.log_index}`} className="border-b border-line"><td className="py-3">{swap.block_number}</td><td>{swap.amount_in_raw}</td><td>{swap.amount_out_raw}</td><td>{config && <a href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${swap.transaction_hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-lime">Open <ExternalLink className="size-3" /></a>}</td></tr>)}</tbody></table>}</div></>;
}
