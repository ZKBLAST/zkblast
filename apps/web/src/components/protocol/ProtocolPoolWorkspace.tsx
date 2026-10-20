"use client";

import { formatUnits } from "viem";
import { ArrowDownUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { useProtocolWorkspace } from "@/lib/use-protocol-workspace";

const control = "mt-2 h-11 w-full border border-line bg-bg px-3 text-fg";

export function ProtocolPoolWorkspace({
  mode,
}: {
  mode: "swap" | "liquidity";
}) {
  const state = useProtocolWorkspace(mode);
  const { pool, bins, amount, busy, quote, amounts, config } = state;
  const disabled =
    busy ||
    Boolean(state.address && (!amount || (mode === "liquidity" && !amounts)));
  const actionLabel = !state.address
    ? "Connect wallet"
    : busy
      ? "Processing…"
      : mode === "liquidity"
        ? "Approve & add liquidity"
        : quote
          ? "Approve & swap"
          : "Get quote";

  return (
    <section className="panel ticks my-8 p-5 sm:p-6">
      <p className="label">Public protocol pools</p>
      <h2 className="mt-2 text-xl font-semibold">
        {mode === "swap" ? "DAMM / DLMM swap" : "DAMM / DLMM liquidity"}
      </h2>
      {pool ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <ProtocolPairLogo
              base={pool.token0Symbol}
              quote={pool.token1Symbol}
              markets={state.markets.items}
            />
            <span className="font-mono text-xs">
              {pool.model.toUpperCase()} · {pool.token0Symbol}/
              {pool.token1Symbol}
            </span>
          </div>
          <label className="mt-4 block text-sm text-muted">
            Pool
            <select
              className={control}
              value={pool.address}
              disabled={busy}
              onChange={(event) => state.selectPool(event.target.value)}
            >
              {state.data.pools.map((item) => (
                <option key={item.address} value={item.address}>
                  {item.token0Symbol}/{item.token1Symbol} ·{" "}
                  {item.model.toUpperCase()} · {item.feeBps} bps
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 flex items-end gap-3">
            <label className="min-w-0 flex-1 text-sm text-muted">
              {mode === "swap" ? "You pay" : "Deposit"} {state.inputSymbol}
              <input
                className={control}
                inputMode="decimal"
                value={amount}
                placeholder="0.0"
                disabled={busy}
                onChange={(event) => state.changeAmount(event.target.value)}
              />
            </label>
            {mode === "swap" ? (
              <Button
                aria-label="Reverse swap direction"
                variant="secondary"
                disabled={busy}
                onClick={state.reverse}
              >
                <ArrowDownUp className="size-4" />
              </Button>
            ) : null}
          </div>
          {mode === "swap" && quote ? (
            <p className="mt-3 text-sm">
              Receive{" "}
              {formatUnits(
                BigInt(quote.amountOut),
                state.reversed ? pool.token0Decimals : pool.token1Decimals,
              )}{" "}
              {state.outputSymbol}
            </p>
          ) : null}
          {mode === "liquidity" ? (
            <p className="mt-3 text-sm text-muted">
              Paired deposit:{" "}
              {amounts
                ? formatUnits(amounts.amount1, pool.token1Decimals)
                : "—"}{" "}
              {pool.token1Symbol}
              {pool.model === "dlmm"
                ? ` · bin ${bins.data?.activeBin ?? "loading"}`
                : ""}
            </p>
          ) : null}
          {mode === "liquidity" && pool.model === "dlmm" && bins.error ? (
            <p className="mt-3 text-sm text-warn">{bins.error}</p>
          ) : null}
          <Button
            className="mt-5 w-full"
            disabled={disabled}
            loading={busy}
            onClick={() => void state.submit()}
          >
            {actionLabel}
          </Button>
          <p className="mt-3 text-xs text-faint">
            1% slippage bound · {config?.chainName ?? "Loading network"}
          </p>
          {state.notice ? (
            <p className="mt-3 text-sm text-muted" role="status">
              {state.notice}
            </p>
          ) : null}
          {state.transactionHash && config ? (
            <a
              className="mt-3 inline-flex items-center gap-1 text-xs text-lime"
              href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${state.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              Transaction receipt <ExternalLink className="size-3" />
            </a>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {state.data.loading
            ? "Loading pool registry…"
            : (state.data.error ?? "Pool registry is synchronizing.")}
        </p>
      )}
    </section>
  );
}
