"use client";

import { parseTokenAmount } from "@zkblast/sdk";

import { useRef, useState } from "react";
import { CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
} from "@/lib/swap-flow";

type PreparedPool = {
  chainId: number;
  factory: string;
  model: "damm" | "dlmm";
  poolId: string;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  feePips: number;
  binStepBps: number;
  initialBin: number | null;
  representedPrice: string | null;
  authorized: boolean;
  simulationPassed: boolean;
  existingPool: string | null;
  permissionNotice: string | null;
  transaction: PreparedTransaction;
  expiresAt: number;
};
const control =
  "mt-2 h-11 w-full min-w-0 border border-line bg-bg px-3 text-sm";

export function CreatePoolPanel({
  onBusyChange,
  onConfirmed,
}: {
  onBusyChange: (busy: boolean) => void;
  onConfirmed: () => void;
}) {
  const { address, config, connect } = useApp();
  const [form, setForm] = useState({
    model: "dlmm" as "damm" | "dlmm",
    tokenA: "",
    tokenB: "",
    feePercent: "0.3",
    binStep: "10",
    initialPrice: "",
  });
  const [review, setReview] = useState<{
    context: string;
    data: PreparedPool;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hash, setHash] = useState("");
  const context = JSON.stringify({ form, address, chainId: config?.chainId });
  const current = useRef(context);
  current.current = context;
  const prepared = review?.context === context ? review.data : null;
  function update<K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setReview(null);
    setNotice("");
    setHash("");
  }
  async function run(create: boolean) {
    if (!address) return connect();
    if (!config) return;
    const requested = context;
    setBusy(true);
    onBusyChange(true);
    setNotice("");
    try {
      if (!create) {
        const feePips = Number(parseTokenAmount(form.feePercent, 4));
        if (!Number.isInteger(feePips) || feePips < 1 || feePips >= 1000000)
          throw new Error("Enter a valid pool fee below 100%.");
        const result = await apiRequest<PreparedPool>(
          webPublicConfig.apiUrl,
          "/v1/protocol/pool-creation/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              model: form.model,
              tokenA: form.tokenA.trim(),
              tokenB: form.tokenB.trim(),
              wallet: address,
              feePips,
              binStepBps: form.model === "dlmm" ? Number(form.binStep) : 0,
              ...(form.model === "dlmm"
                ? { initialPrice: form.initialPrice }
                : {}),
            }),
          },
        );
        if (requested !== current.current) return;
        if (result.chainId !== config.chainId)
          throw new Error("Creation network mismatch.");
        setReview({ context: requested, data: result });
        return;
      }
      if (
        !prepared ||
        !prepared.authorized ||
        !prepared.simulationPassed ||
        prepared.existingPool ||
        Date.now() >= prepared.expiresAt
      )
        throw new Error(
          "Validate an authorized, non-duplicate pool again before signing.",
        );
      if (!window.ethereum) throw new Error("Wallet provider unavailable.");
      const receipt = await executeTransactions(
        window.ethereum,
        address,
        prepared.chainId,
        [prepared.transaction],
        (stage, tx) => {
          setNotice(stage.replaceAll("-", " "));
          if (tx) setHash(tx);
        },
      );
      setHash(receipt);
      setReview(null);
      setNotice(
        "Pool creation confirmed. New pools need liquidity before trading; indexing may take time.",
      );
      onConfirmed();
    } catch (error) {
      setNotice(swapErrorMessage(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="space-y-4 p-4" aria-label="Create pool">
      <div>
        <p className="label">Pool builder</p>
        <h2 className="mt-2 text-xl">Create a public pool</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Choose DAMM or DLMM, validate both token contracts, then review before
          signing. Creation does not add liquidity.
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm">
          Pool model
          <select
            className={control}
            value={form.model}
            onChange={(e) => update("model", e.target.value as "damm" | "dlmm")}
          >
            <option value="dlmm">DLMM — discrete price bins</option>
            <option value="damm">DAMM — dynamic-fee AMM</option>
          </select>
        </label>
        {(["tokenA", "tokenB"] as const).map((key) => (
          <label key={key} className="block text-sm">
            Token {key === "tokenA" ? "A" : "B"} contract
            <input
              className={control}
              spellCheck={false}
              autoComplete="off"
              value={form[key]}
              placeholder="0x…"
              onChange={(e) => update(key, e.target.value)}
            />
          </label>
        ))}
        <label className="block text-sm">
          Pool fee (%)
          <input
            className={control}
            inputMode="decimal"
            value={form.feePercent}
            onChange={(e) => update("feePercent", e.target.value)}
          />
        </label>
        {form.model === "dlmm" && (
          <>
            <label className="block text-sm">
              Bin step (bps)
              <input
                className={control}
                inputMode="numeric"
                value={form.binStep}
                onChange={(e) => update("binStep", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Initial price — token B per token A
              <input
                className={control}
                inputMode="decimal"
                value={form.initialPrice}
                placeholder="Enter the intended starting price"
                onChange={(e) => update("initialPrice", e.target.value)}
              />
            </label>
            <p className="text-xs text-muted">
              Token decimal differences and canonical sorting are applied by the
              API. The represented bin price is shown in review.
            </p>
          </>
        )}
      </fieldset>
      <Button
        className="w-full"
        variant="secondary"
        loading={busy}
        onClick={() => void run(false)}
      >
        {address ? "Validate & review" : "Connect wallet"}
      </Button>
      {prepared && (
        <div className="space-y-3 border border-line p-3 text-xs">
          <p className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            Validated on chain {prepared.chainId}
          </p>
          <p>
            Canonical pair: {prepared.token0.symbol}/{prepared.token1.symbol} ·{" "}
            {prepared.model.toUpperCase()}
          </p>
          <p>
            Fee: {prepared.feePips / 10000}%
            {prepared.initialBin !== null
              ? ` · bin ${prepared.initialBin} · ${prepared.binStepBps} bps step`
              : ""}
          </p>
          {prepared.representedPrice && (
            <p>
              Represented price: {prepared.representedPrice}{" "}
              {prepared.token1.symbol} per {prepared.token0.symbol}
            </p>
          )}
          <p className="break-all">Factory: {prepared.factory}</p>
          {prepared.existingPool && (
            <p className="break-all text-warn">
              This pool already exists: {prepared.existingPool}. Add liquidity
              to it instead.
            </p>
          )}
          {prepared.permissionNotice && (
            <p className="text-warn">
              <ShieldAlert className="mb-1 size-4" />
              {prepared.permissionNotice}
            </p>
          )}
          <Button
            className="w-full"
            disabled={
              busy ||
              !prepared.authorized ||
              !prepared.simulationPassed ||
              Boolean(prepared.existingPool)
            }
            onClick={() => void run(true)}
          >
            Create {prepared.model.toUpperCase()} pool
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {hash && config && (
        <a
          href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 break-all text-xs text-lime"
        >
          Transaction receipt <ExternalLink className="size-3" />
        </a>
      )}
    </section>
  );
}
