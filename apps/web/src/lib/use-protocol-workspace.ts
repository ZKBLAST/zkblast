"use client";

import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useApp } from "@/components/shell/AppProvider";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { useProtocolData } from "@/lib/use-protocol-data";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { useDlmmBins } from "@/lib/use-dlmm-bins";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
} from "@/lib/swap-flow";

type Quote = {
  chainId: number;
  amountOut: string;
  approval: PreparedTransaction;
  swap: PreparedTransaction;
};
type PreparedLiquidity = {
  chainId: number;
  approvals: PreparedTransaction[];
  position: PreparedTransaction;
};
type Reserves = { reserve0: string; reserve1: string; totalShares: string };

export function useProtocolWorkspace(mode: "swap" | "liquidity") {
  const { address, config, connect, toast } = useApp();
  const data = useProtocolData();
  const markets = useExternalMarkets();
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [reversed, setReversed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accounting, setAccounting] = useState<Reserves | null>(null);
  const [revision, setRevision] = useState(0);
  const pool =
    data.pools.find((item) => item.address === selected) ??
    data.pools.find((item) => item.model === "dlmm") ??
    data.pools[0];
  const bins = useDlmmBins(
    pool?.model === "dlmm" ? pool.address : undefined,
    revision,
  );

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

  const state =
    pool?.model === "dlmm" &&
    bins.data?.pool.toLowerCase() === pool.address.toLowerCase()
      ? bins.data.bins.find((bin) => bin.binId === bins.data?.activeBin)
      : accounting;
  let amounts: {
    amount0: bigint;
    amount1: bigint;
    minimumShares: bigint;
  } | null = null;
  if (pool && state && mode === "liquidity") {
    try {
      const amount0 = parseUnits(amount, pool.token0Decimals);
      const reserve0 = BigInt(state.reserve0);
      const reserve1 = BigInt(state.reserve1);
      const totalShares = BigInt(state.totalShares);
      if (amount0 > 0n && reserve0 > 0n && reserve1 > 0n && totalShares > 0n) {
        const amount1 = (amount0 * reserve1) / reserve0;
        const shares0 = (amount0 * totalShares) / reserve0;
        const shares1 = (amount1 * totalShares) / reserve1;
        if (amount1 > 0n)
          amounts = {
            amount0,
            amount1,
            minimumShares:
              ((shares0 < shares1 ? shares0 : shares1) * 99n) / 100n,
          };
      }
    } catch {
      /* Incomplete decimal input leaves submission disabled. */
    }
  }
  const inputSymbol =
    reversed && mode === "swap" ? pool?.token1Symbol : pool?.token0Symbol;
  const outputSymbol = reversed ? pool?.token0Symbol : pool?.token1Symbol;

  async function submit() {
    if (!address) return connect();
    if (!pool || !window.ethereum) return;
    setBusy(true);
    setNotice("");
    try {
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
              amountIn: parseUnits(
                amount,
                reversed ? pool.token1Decimals : pool.token0Decimals,
              ).toString(),
              slippageBps: 100,
              recipient: address,
              deadline,
              token0ToToken1: !reversed,
              maximumBinCrossings: 16,
            }),
          },
        );
        setQuote(result);
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
              ...(pool.model === "dlmm" ? { binId: bins.data?.activeBin } : {}),
            }),
          },
        );
        transactions = [...prepared.approvals, prepared.position];
        chainId = prepared.chainId;
      } else {
        if (!quote) return;
        transactions = [quote.approval, quote.swap];
        chainId = quote.chainId;
      }
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
      toast({
        kind: "success",
        title: mode === "swap" ? "Pool swap confirmed" : "LP position created",
      });
      setRevision((value) => value + 1);
      await data.refresh();
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
