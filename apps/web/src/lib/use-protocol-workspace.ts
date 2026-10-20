"use client";

import { useEffect, useRef, useState } from "react";
import { parseTokenAmount } from "@zkblast/sdk";
import { liquidityAmounts } from "./liquidity-amounts";
import type {
  WorkspaceQuote as Quote,
  PreparedLiquidity,
  PoolReserves as Reserves,
} from "./protocol-workspace-types";
import { usePoolTokenBalances } from "./use-pool-token-balances";
import { useApp } from "@/components/shell/AppProvider";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { useDlmmBins } from "@/lib/use-dlmm-bins";
import type { ProtocolExecutionPool } from "@/types/application";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
} from "@/lib/swap-flow";

export type WorkspaceOptions = {
  pool?: ProtocolExecutionPool;
  onBusyChange?: (busy: boolean) => void;
  onConfirmed?: () => void;
};

export function useProtocolWorkspace(
  mode: "swap" | "liquidity",
  options: WorkspaceOptions = {},
) {
  const { address, config, connect, toast, refreshAccount } = useApp();
  const data = useProtocolData();
  const markets = useExternalMarkets();
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [seedAmount, setSeedAmount] = useState("");
  const [selectedBin, setSelectedBin] = useState<number | null>(null);
  const [slippageBps, setSlippageBps] = useState(100);
  const [reversed, setReversed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accounting, setAccounting] = useState<Reserves | null>(null);
  const [revision, setRevision] = useState(0);
  const pool =
    options.pool ??
    data.pools.find((item) => item.address === selected) ??
    data.pools.find((item) => item.model === "dlmm") ??
    data.pools[0];
  const context = `${address}:${config?.chainId}:${pool?.address}:${mode}:${reversed}:${amount}:${seedAmount}:${selectedBin}:${slippageBps}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const bins = useDlmmBins(
    pool?.model === "dlmm" ? pool.address : undefined,
    revision,
  );

  useEffect(() => {
    options.onBusyChange?.(busy);
  }, [busy, options.onBusyChange]);
  useEffect(() => {
    setQuote(null);
    setAmount("");
    setReversed(false);
    setSeedAmount("");
    setSelectedBin(null);
  }, [pool?.address, address, config?.chainId, mode]);

  useEffect(() => {
    let cancelled = false;
    setAccounting(null);
    setQuote(null);
    setNotice("");
    if (mode !== "liquidity" || !pool || pool.model !== "damm") return;
    void apiRequest<Reserves>(
      webPublicConfig.apiUrl,
      `/v1/protocol/accounting/${pool.address}`,
    )
      .then((value) => {
        if (!cancelled) setAccounting(value);
      })
      .catch(() => {
        if (!cancelled) setNotice("Pool reserves could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [pool?.address, pool?.model, mode, revision]);

  const activeBin = selectedBin ?? bins.data?.activeBin;
  const state =
    pool?.model === "dlmm" &&
    bins.data?.pool.toLowerCase() === pool.address.toLowerCase()
      ? bins.data.bins.find((bin) => bin.binId === activeBin)
      : accounting;
  const amounts =
    pool && mode === "liquidity"
      ? liquidityAmounts({
          amount,
          seedAmount,
          slippageBps,
          state,
          decimals0: pool.token0Decimals,
          decimals1: pool.token1Decimals,
          minimumLockedLiquidity:
            pool.model === "dlmm"
              ? bins.data?.minimumLockedLiquidity
              : accounting?.minimumLockedLiquidity,
        })
      : null;
  const balances = usePoolTokenBalances(
    pool,
    address,
    config?.chainId,
    revision,
  );
  const bootstrap = Boolean(state && BigInt(state.totalShares) === 0n);
  const inputSymbol =
    reversed && mode === "swap" ? pool?.token1Symbol : pool?.token0Symbol;
  const outputSymbol = reversed ? pool?.token0Symbol : pool?.token1Symbol;
  let validAmount = false;
  let insufficientBalance = false;
  try {
    const raw = parseTokenAmount(
      amount,
      reversed && mode === "swap" ? pool.token1Decimals : pool.token0Decimals,
    );
    validAmount = raw > 0n;
    if (balances)
      insufficientBalance =
        mode === "liquidity" && amounts
          ? amounts.amount0 > balances[0] || amounts.amount1 > balances[1]
          : raw > balances[reversed && mode === "swap" ? 1 : 0];
  } catch {
    /* Invalid/over-precision input cannot be submitted. */
  }

  async function submit() {
    if (!address) return connect();
    if (!pool || !window.ethereum) return;
    setBusy(true);
    setNotice("");
    const requestedContext = context;
    try {
      if (!validAmount || insufficientBalance)
        throw new Error("Enter a valid amount within your token balance.");
      const deadline = String(Math.floor(Date.now() / 1000) + 900);
      if (mode === "swap" && !quote) {
        const result = await apiRequest<Quote>(
          webPublicConfig.apiUrl,
          "/v1/protocol/swap/quote",
          {
            method: "POST",
            body: JSON.stringify({
              model: pool.model,
              pool: pool.address,
              tokenIn: reversed ? pool.token1Address : pool.token0Address,
              amountIn: parseTokenAmount(
                amount,
                reversed ? pool.token1Decimals : pool.token0Decimals,
              ).toString(),
              slippageBps,
              recipient: address,
              deadline,
              token0ToToken1: !reversed,
              maximumBinCrossings: 16,
            }),
          },
        );
        if (currentContext.current !== requestedContext) return;
        setQuote({ ...result, expiresAt: Number(deadline) * 1000 });
        return;
      }
      let transactions: readonly PreparedTransaction[];
      let chainId: number;
      if (mode === "liquidity") {
        if (!amounts)
          throw new Error(
            "Wait for funded pool reserves and enter a valid amount.",
          );
        const prepared = await apiRequest<PreparedLiquidity>(
          webPublicConfig.apiUrl,
          "/v1/protocol/liquidity/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              model: pool.model,
              pool: pool.address,
              token0: pool.token0Address,
              token1: pool.token1Address,
              amount0: amounts.amount0.toString(),
              amount1: amounts.amount1.toString(),
              minimumShares: amounts.minimumShares.toString(),
              deadline,
              ...(pool.model === "dlmm" ? { binId: activeBin } : {}),
            }),
          },
        );
        transactions = [...prepared.approvals, prepared.position];
        chainId = prepared.chainId;
      } else {
        if (!quote) return;
        if (Date.now() >= quote.expiresAt) {
          setQuote(null);
          setNotice("Quote expired. Request a fresh quote before signing.");
          return;
        }
        transactions = [quote.approval, quote.swap];
        chainId = quote.chainId;
      }
      if (currentContext.current !== requestedContext)
        throw new Error(
          "Wallet or market changed. Prepare the transaction again.",
        );
      const hash = await executeTransactions(
        window.ethereum,
        address,
        chainId,
        transactions,
        (step, hash) => {
          setNotice(step.replaceAll("-", " "));
          if (hash) setTransactionHash(hash);
        },
      );
      setTransactionHash(hash);
      setQuote(null);
      setNotice(
        "Transaction confirmed. Positions and pool activity refresh from the network.",
      );
      if (mode === "swap") {
        const tokenIn = reversed ? pool.token1Address : pool.token0Address;
        const market = markets.items.find(
          (item) =>
            item.contractAddress.toLowerCase() === tokenIn.toLowerCase() &&
            item.pairCandidates.some(
              (route) =>
                route.routeStatus === "validated" &&
                route.poolIdentifier?.toLowerCase() ===
                  pool.address.toLowerCase(),
            ),
        );
        const route = market?.pairCandidates.find(
          (item) =>
            item.routeStatus === "validated" &&
            item.poolIdentifier?.toLowerCase() === pool.address.toLowerCase(),
        );
        if (
          pool.model === "damm" &&
          market &&
          route &&
          route.quoteSymbol !== "ETH"
        ) {
          try {
            await apiRequest(webPublicConfig.apiUrl, "/v1/me/trades/confirm", {
              method: "POST",
              body: JSON.stringify({
                clientRequestId: crypto.randomUUID(),
                marketId: market.id,
                quoteSymbol: route.quoteSymbol,
                transactionHash: hash,
              }),
            });
          } catch {
            setNotice(
              "Transaction confirmed onchain. Account history sync is pending; keep the receipt.",
            );
          }
        } else {
          setNotice(
            "Transaction confirmed onchain. Use the receipt for this route; saved account history may not include it yet.",
          );
        }
      }
      toast({
        kind: "success",
        title: mode === "swap" ? "Pool swap confirmed" : "LP position created",
      });
      setRevision((value) => value + 1);
      options.onConfirmed?.();
      await data.refresh();
      await refreshAccount().catch(() => {
        setNotice(
          "Transaction confirmed onchain. Sign in again to refresh account history.",
        );
      });
    } catch (error) {
      setNotice(swapErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    address,
    config,
    data,
    markets,
    pool,
    bins,
    amount,
    busy,
    notice,
    transactionHash,
    quote,
    amounts,
    reversed,
    seedAmount,
    setSeedAmount,
    bootstrap,
    activeBin,
    selectedBin,
    setSelectedBin,
    slippageBps,
    setSlippageBps: (value: number) => {
      setSlippageBps(value);
      setQuote(null);
    },
    balances,
    validAmount,
    insufficientBalance,
    inputSymbol,
    outputSymbol,
    submit,
    selectPool: (value: string) => {
      setSelected(value);
      setQuote(null);
      setAmount("");
    },
    changeAmount: (value: string) => {
      setAmount(value);
      setQuote(null);
    },
    reverse: () => {
      setReversed(!reversed);
      setQuote(null);
      setAmount("");
    },
  };
}
