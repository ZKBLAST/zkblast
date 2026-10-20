"use client";

import { ExternalLink, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";

import { MarketPairLogo } from "@/components/markets/MarketPairLogo";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
  type TransactionExecutionState,
} from "@/lib/swap-flow";
import type { ExternalMarket } from "@/types/application";

type Accounting = Readonly<{
  chainId: number;
  pool: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  totalShares: string;
  reconciled: boolean;
}>;
type PreparedLiquidity = Readonly<{
  chainId: number;
  approvals: readonly PreparedTransaction[];
  position: PreparedTransaction;
}>;

export function ExternalLiquidityPanel({
  markets,
  onConfirmed,
}: Readonly<{
  markets: readonly ExternalMarket[];
  onConfirmed?: () => void | Promise<void>;
}>) {
  const { address, config, connect, toast } = useApp();
  const executable = useMemo(
    () =>
      markets.flatMap((market) =>
        market.pairCandidates
          .filter(
            (candidate) =>
              candidate.routeStatus === "validated" &&
              candidate.quoteSymbol === "USDG" &&
              candidate.poolIdentifier &&
              candidate.baseAddress,
          )
          .map((route) => ({ market, route })),
      ),
    [markets],
  );
  const [selection, setSelection] = useState("");
  const selected =
    executable.find(({ route }) => route.poolIdentifier === selection) ??
    executable[0];
  const [baseAmount, setBaseAmount] = useState("0.001");
  const [accounting, setAccounting] = useState<Accounting | null>(null);
  const [state, setState] = useState<
    TransactionExecutionState | "idle" | "preparing" | "failed"
  >("idle");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  useEffect(() => {
    if (!selected?.route.poolIdentifier) return;
    setAccounting(null);
    setNotice("");
    void apiRequest<Accounting>(
      webPublicConfig.apiUrl,
      `/v1/protocol/accounting/${selected.route.poolIdentifier}`,
    )
      .then(setAccounting)
      .catch(() => setNotice("Pool accounting is temporarily unavailable."));
  }, [selected?.route.poolIdentifier]);

  const amounts = useMemo(() => {
    if (!selected?.route.baseAddress || !accounting) return null;
    try {
      const baseRaw = parseUnits(baseAmount, 18);
      if (baseRaw <= 0n) return null;
      const baseIsToken0 =
        accounting.token0.toLowerCase() ===
        selected.route.baseAddress.toLowerCase();
      const baseReserve = BigInt(
        baseIsToken0 ? accounting.reserve0 : accounting.reserve1,
      );
      const quoteReserve = BigInt(
        baseIsToken0 ? accounting.reserve1 : accounting.reserve0,
      );
      const totalShares = BigInt(accounting.totalShares);
      if (baseReserve <= 0n || quoteReserve <= 0n || totalShares <= 0n)
        return null;
      const quoteRaw = (baseRaw * quoteReserve) / baseReserve;
      const token0Raw = baseIsToken0 ? baseRaw : quoteRaw;
      const token1Raw = baseIsToken0 ? quoteRaw : baseRaw;
      const estimatedShares =
        (token0Raw * totalShares) / BigInt(accounting.reserve0) <
        (token1Raw * totalShares) / BigInt(accounting.reserve1)
          ? (token0Raw * totalShares) / BigInt(accounting.reserve0)
          : (token1Raw * totalShares) / BigInt(accounting.reserve1);
      return {
        token0Raw,
        token1Raw,
        quoteRaw,
        minimumShares: (estimatedShares * 99n) / 100n,
      };
    } catch {
      return null;
    }
  }, [accounting, baseAmount, selected?.route.baseAddress]);

  async function addLiquidity() {
    if (!address) return connect();
    if (!selected?.route.poolIdentifier || !accounting || !amounts)
      return setNotice("Enter a valid amount and wait for pool accounting.");
    if (!accounting.reconciled)
      return setNotice("Pool accounting is not reconciled; action blocked.");
    if (!window.ethereum) return setNotice("Wallet extension not detected.");
    setState("preparing");
    setNotice("");
    try {
      const prepared = await apiRequest<PreparedLiquidity>(
        webPublicConfig.apiUrl,
        "/v1/protocol/liquidity/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            model: "damm",
            pool: selected.route.poolIdentifier,
            token0: accounting.token0,
            token1: accounting.token1,
            amount0: amounts.token0Raw.toString(),
            amount1: amounts.token1Raw.toString(),
            minimumShares: amounts.minimumShares.toString(),
            deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
          }),
        },
      );
      const hash = await executeTransactions(
        window.ethereum,
        address,
        prepared.chainId,
        [...prepared.approvals, prepared.position],
        (next, transaction) => {
          setState(next);
          if (transaction) setTransactionHash(transaction);
        },
        "Add liquidity",
      );
      setTransactionHash(hash);
      await onConfirmed?.();
      toast({
        kind: "success",
        title: "Liquidity position created",
        body: `${selected.market.symbol}/USDG confirmed on-chain.`,
      });
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  if (!selected) return null;
  const busy = !["idle", "failed", "confirmed"].includes(state);
  return (
    <section className="panel ticks mt-8 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MarketPairLogo market={selected.market} />
          <div>
            <p className="label">Create on-chain LP position</p>
            <h2 className="mt-1 text-xl font-semibold">Add liquidity</h2>
          </div>
        </div>
        <Plus className="size-5 text-lime" aria-hidden />
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="text-sm text-muted">
          Validated pool
          <select
            className="mt-2 h-11 w-full border border-line bg-bg px-3 text-fg"
            value={selected.route.poolIdentifier ?? ""}
            onChange={(event) => setSelection(event.target.value)}
          >
            {executable.map(({ market, route }) => (
              <option
                key={route.poolIdentifier}
                value={route.poolIdentifier ?? ""}
              >
                {market.symbol}/{route.quoteSymbol}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          {selected.market.symbol} amount
          <input
            className="mt-2 h-11 w-full border border-line bg-bg px-3 font-mono text-fg"
            inputMode="decimal"
            value={baseAmount}
            onChange={(event) => setBaseAmount(event.target.value)}
          />
        </label>
        <div className="text-sm text-muted">
          Required USDG raw
          <div className="mt-2 flex h-11 items-center border border-line bg-bg px-3 font-mono text-fg">
            {amounts?.quoteRaw.toString() ?? "—"}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        The USDG amount follows the current reserve ratio. Minimum LP shares use
        a 1% safety bound. Two exact approvals and one Position Manager
        transaction will be requested.
      </p>
      <Button
        className="mt-5"
        disabled={busy || !amounts}
        onClick={() => void addLiquidity()}
      >
        {!address
          ? "Connect wallet"
          : busy
            ? state.replaceAll("-", " ")
            : "Approve & add liquidity"}
      </Button>
      {notice ? <p className="mt-3 text-sm text-danger">{notice}</p> : null}
      {transactionHash && config ? (
        <a
          className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-lime"
          href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View receipt <ExternalLink className="size-3" />
        </a>
      ) : null}
    </section>
  );
}
