"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useApp } from "@/components/shell/AppProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  useAssistanceFund,
  type AssistanceReceipt,
} from "@/lib/use-assistance-fund";

const compact = (value: string) => {
  const amount = BigInt(value || "0");
  return amount >= 1_000_000n ? `${amount / 1_000_000n}M raw` : `${amount} raw`;
};
const short = (value?: string) =>
  value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

function ReceiptTable({
  title,
  items,
  explorerUrl,
}: Readonly<{
  title: string;
  items: readonly AssistanceReceipt[];
  explorerUrl: string;
}>) {
  return (
    <section className="min-w-0 border border-line bg-panel/30">
      <h3 className="border-b border-line px-4 py-3 font-mono text-xs uppercase tracking-[0.16em]">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left font-mono text-xs">
          <thead className="text-muted">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Source / route</th>
              <th className="p-3">Input</th>
              <th className="p-3">Output / burn</th>
              <th className="p-3">Block</th>
              <th className="p-3">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => (
              <tr key={`${item.transactionHash}:${item.blockNumber}`}>
                <td className="p-3">
                  {new Date(item.observedAt).toLocaleString()}
                </td>
                <td className="p-3">{short(item.routeId ?? item.sourceId)}</td>
                <td className="p-3">
                  {compact(item.amountInRaw ?? item.eligibleAmountRaw ?? "0")}
                </td>
                <td className="p-3">
                  <span>
                    {compact(item.amountOutRaw ?? item.amountRaw ?? "0")}
                  </span>
                  {item.referencePriceX18 ? (
                    <span className="mt-1 block text-muted">
                      ref {item.referencePriceX18} · exec{" "}
                      {item.executionPriceX18}
                    </span>
                  ) : null}
                  {item.totalSupplyAfterRaw ? (
                    <span className="mt-1 block text-muted">
                      supply {compact(item.totalSupplyBeforeRaw ?? "0")} →{" "}
                      {compact(item.totalSupplyAfterRaw)}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">{item.blockNumber}</td>
                <td className="p-3">
                  <a
                    className="inline-flex items-center gap-1 text-lime"
                    href={`${explorerUrl.replace(/\/$/u, "")}/tx/${item.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(item.transactionHash)}{" "}
                    <ExternalLink className="size-3" />
                  </a>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="p-5 text-muted" colSpan={6}>
                  No indexed receipts for this network.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AssistanceFundDashboard() {
  const { config } = useApp();
  const fund = useAssistanceFund();
  if (!config || (!fund.available && !fund.loading)) return null;
  const contracts =
    config.contracts?.filter((contract) =>
      /Assistance|Buyback|BurnModule|TreasuryController/u.test(contract.name),
    ) ?? [];

  return (
    <section
      className="mt-14 border-t border-line pt-10"
      aria-labelledby="assistance-fund-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">
            Protocol-owned revenue
          </p>
          <h2 id="assistance-fund-title" className="display mt-2 text-3xl">
            Assistance Fund
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Eligible protocol revenue is accounted in original token units. The
            99% buyback allocation and 1% treasury allocation remain
            independently reconcilable.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fund.refresh()}
          className="inline-flex items-center gap-2 border border-line px-3 py-2 font-mono text-xs uppercase"
          disabled={fund.loading}
        >
          <RefreshCw
            className={`size-3 ${fund.loading ? "animate-spin" : ""}`}
          />{" "}
          Refresh
        </button>
      </div>
      {fund.loading && !fund.revenue.length ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <dl className="mt-6 grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Eligible · 24h", fund.summary.windows.eligible24hRaw],
              ["Eligible · 7d", fund.summary.windows.eligible7dRaw],
              ["Eligible · 30d", fund.summary.windows.eligible30dRaw],
              ["ZKBLAST burned", fund.summary.burnedProtocolTokenRaw],
            ].map(([label, value]) => (
              <div key={label} className="bg-bg p-4">
                <dt className="font-mono text-xs uppercase text-muted">
                  {label}
                </dt>
                <dd className="mt-3 font-mono text-lg">{compact(value!)}</dd>
              </div>
            ))}
          </dl>
          <section className="mt-5 overflow-x-auto border border-line">
            <h3 className="border-b border-line px-4 py-3 font-mono text-xs uppercase tracking-[0.16em]">
              Asset accounting
            </h3>
            <table className="w-full min-w-[760px] text-left font-mono text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="p-3">Asset</th>
                  <th className="p-3">Eligible</th>
                  <th className="p-3">Buyback · 99%</th>
                  <th className="p-3">Treasury · 1%</th>
                  <th className="p-3">Pending buyback</th>
                  <th className="p-3">Treasury claimable</th>
                  <th className="p-3">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fund.summary.assets.map((asset) => {
                  const reconciliation = fund.summary.reconciliation.find(
                    (item) =>
                      item.assetAddress.toLowerCase() ===
                      asset.assetAddress.toLowerCase(),
                  );
                  return (
                    <tr key={asset.assetAddress}>
                      <td className="p-3">{short(asset.assetAddress)}</td>
                      <td className="p-3">
                        {compact(asset.eligibleAmountRaw)}
                      </td>
                      <td className="p-3">
                        {compact(asset.allocatedBuybackRaw)}
                      </td>
                      <td className="p-3">
                        {compact(asset.allocatedTreasuryRaw)}
                      </td>
                      <td className="p-3">
                        {compact(reconciliation?.pendingBuybackRaw ?? "0")}
                      </td>
                      <td className="p-3">
                        {compact(reconciliation?.treasuryClaimableRaw ?? "0")}
                      </td>
                      <td
                        className={`p-3 uppercase ${reconciliation?.solvent === false ? "text-red-400" : "text-lime"}`}
                      >
                        {reconciliation
                          ? reconciliation.solvent
                            ? "reconciled"
                            : "attention"
                          : "indexed"}
                      </td>
                    </tr>
                  );
                })}
                {!fund.summary.assets.length ? (
                  <tr>
                    <td colSpan={7} className="p-5 text-muted">
                      No eligible protocol revenue has been indexed for this
                      network.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <ReceiptTable
              title="Eligible revenue"
              items={fund.revenue}
              explorerUrl={config.explorerUrl}
            />
            <ReceiptTable
              title="Buyback and burn receipts"
              items={[...fund.buybacks, ...fund.burns].sort((a, b) =>
                Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)),
              )}
              explorerUrl={config.explorerUrl}
            />
          </div>
          {contracts.length ? (
            <div className="mt-5 border border-line p-4">
              <h3 className="font-mono text-xs uppercase tracking-[0.16em]">
                Canonical contracts
              </h3>
              <ul className="mt-3 grid gap-2 md:grid-cols-2">
                {contracts.map((contract) => (
                  <li
                    key={contract.name}
                    className="flex min-w-0 items-center justify-between gap-3 font-mono text-xs"
                  >
                    <span>{contract.name}</span>
                    <a
                      className="break-all text-lime"
                      href={`${config.explorerUrl.replace(/\/$/u, "")}/address/${contract.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {contract.address}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      {fund.error && fund.available ? (
        <p className="mt-4 font-mono text-xs text-red-400">
          Data refresh failed. Existing indexed values remain visible.
        </p>
      ) : null}
    </section>
  );
}
