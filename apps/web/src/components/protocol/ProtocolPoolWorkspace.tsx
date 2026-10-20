"use client";

import { formatUnits } from "viem";
import { ArrowDownUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { TokenAmountField } from "./TokenAmountField";
import {
  useProtocolWorkspace,
  type WorkspaceOptions,
} from "@/lib/use-protocol-workspace";

const control = "mt-2 h-11 w-full border border-line bg-bg px-3 text-fg";

export function ProtocolPoolWorkspace({
  mode,
  compact = false,
  ...options
}: WorkspaceOptions & {
  mode: "swap" | "liquidity";
  compact?: boolean;
}) {
  const state = useProtocolWorkspace(mode, options);
  const { pool, bins, amount, busy, quote, amounts, config } = state;
  const disabled =
    busy ||
    Boolean(
      state.address &&
      (!state.validAmount ||
        state.insufficientBalance ||
        (mode === "liquidity" && !amounts)),
    );
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
    <section className={compact ? "p-4" : "panel ticks my-8 p-5 sm:p-6"}>
      <p className="label">
        {compact ? "Public execution" : "Public protocol pools"}
      </p>
      <h2 className="mt-2 text-xl font-semibold">
        {mode === "swap" ? "Swap" : "Add liquidity"}
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
          {!options.pool && (
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
          )}
          <TokenAmountField
            label={mode === "swap" ? "You pay" : "Deposit token 0"}
            symbol={state.inputSymbol ?? ""}
            decimals={
              state.reversed && mode === "swap"
                ? pool.token1Decimals
                : pool.token0Decimals
            }
            value={amount}
            balance={
              state.balances?.[state.reversed && mode === "swap" ? 1 : 0]
            }
            disabled={busy}
            onChange={state.changeAmount}
          />
          {mode === "swap" ? (
            <Button
              className="mx-auto mt-2 flex"
              aria-label="Reverse swap direction"
              variant="secondary"
              disabled={busy}
              onClick={state.reverse}
            >
              <ArrowDownUp className="size-4" />
            </Button>
          ) : null}
          {mode === "swap" && (
            <TokenAmountField
              label="You receive (quote)"
              symbol={state.outputSymbol ?? ""}
              decimals={
                state.reversed ? pool.token0Decimals : pool.token1Decimals
              }
              value={
                quote
                  ? formatUnits(
                      BigInt(quote.amountOut),
                      state.reversed
                        ? pool.token0Decimals
                        : pool.token1Decimals,
                    )
                  : ""
              }
              balance={state.balances?.[state.reversed ? 0 : 1]}
              disabled={busy}
              readOnly
            />
          )}
          {mode === "liquidity" && (
            <>
              <TokenAmountField
                label={
                  state.bootstrap ? "Initial paired deposit" : "Paired deposit"
                }
                symbol={pool.token1Symbol}
                decimals={pool.token1Decimals}
                value={
                  state.bootstrap
                    ? state.seedAmount
                    : amounts
                      ? formatUnits(amounts.amount1, pool.token1Decimals)
                      : ""
                }
                balance={state.balances?.[1]}
                disabled={busy}
                readOnly={!state.bootstrap}
                onChange={state.setSeedAmount}
              />
              {state.bootstrap && (
                <p className="mt-2 text-xs text-warn">
                  {pool.model === "dlmm"
                    ? "This initializes liquidity in the selected fixed-price bin; deposit amounts do not change its price."
                    : "First liquidity sets the reserve ratio."} A minimum share
                  amount is permanently locked; review both amounts carefully.
                </p>
              )}
              {pool.model === "dlmm" && (
                <label className="mt-4 block text-xs text-muted">
                  DLMM position — single bin
                  <select
                    className={control}
                    disabled={busy || !bins.data}
                    value={state.activeBin ?? ""}
                    onChange={(e) =>
                      state.setSelectedBin(Number(e.target.value))
                    }
                  >
                    {bins.data?.bins.map((bin) => (
                      <option key={bin.binId} value={bin.binId}>
                        Bin {bin.binId}
                        {bin.binId === bins.data?.activeBin ? " · active" : ""}
                        {BigInt(bin.totalShares) === 0n
                          ? " · initialize"
                          : " · funded"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <label className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
            Slippage limit
            <select
              aria-label="Slippage limit"
              className="h-9 border border-line bg-bg px-2"
              value={state.slippageBps}
              disabled={busy}
              onChange={(e) => state.setSlippageBps(Number(e.target.value))}
            >
              <option value={10}>0.1%</option>
              <option value={50}>0.5%</option>
              <option value={100}>1%</option>
            </select>
          </label>
          {state.insufficientBalance && (
            <p role="alert" className="mt-2 text-xs text-warn">
              Insufficient token balance for these amounts.
            </p>
          )}
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
            {state.slippageBps / 100}% slippage bound ·{" "}
            {config?.chainName ?? "Loading network"}
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
