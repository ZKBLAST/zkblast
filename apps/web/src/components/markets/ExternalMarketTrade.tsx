"use client";

import { ArrowRightLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import {
  executeSwap,
  swapErrorMessage,
  type PreparedTransaction,
  type SwapExecutionState,
} from "@/lib/swap-flow";
import type { ExternalMarket } from "@/types/application";

type Quote = Readonly<{
  chainId: number;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  symbol: string;
  quoteSymbol: "USDG" | "WETH";
  poolAddress: string;
  approval: PreparedTransaction;
  swap: PreparedTransaction;
}>;

export function ExternalMarketTrade({
  market,
}: {
  market: ExternalMarket | null;
}) {
  const { address, config, connect, refreshAccount, toast } = useApp();
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<
    SwapExecutionState | "idle" | "quoting" | "failed"
  >("idle");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const validatedRoutes = market?.pairCandidates.filter(
    (candidate) => candidate.routeStatus === "validated",
  );
  const route =
    validatedRoutes?.find((candidate) => candidate.quoteSymbol === "USDG") ??
    (config?.environment === "mainnet"
      ? validatedRoutes?.find((candidate) => candidate.quoteSymbol === "WETH")
      : undefined);

  useEffect(() => {
    setQuote(null);
    setNotice("");
    setTransactionHash("");
    setState("idle");
  }, [market?.id, route?.quoteSymbol]);

  async function requestQuote() {
    if (!address) return connect();
    if (!market || !route) return;
    setState("quoting");
    setNotice("");
    setQuote(null);
    try {
      const result = await apiRequest<Quote>(
        webPublicConfig.apiUrl,
        `/v1/markets/${market.id}/quote`,
        {
          method: "POST",
          body: JSON.stringify({
            quoteSymbol: route.quoteSymbol,
            amount,
            slippageBps: 50,
            recipient: address,
            deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
          }),
        },
      );
      setQuote(result);
      setState("idle");
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  async function submit() {
    if (!quote || !address || !window.ethereum) return;
    const clientRequestId = crypto.randomUUID();
    try {
      const hash = await executeSwap(
        window.ethereum,
        address,
        quote.chainId,
        quote.approval,
        quote.swap,
        (next, transaction) => {
          setState(next);
          if (transaction) setTransactionHash(transaction);
        },
      );
      setTransactionHash(hash);
      await apiRequest(webPublicConfig.apiUrl, "/v1/me/trades/confirm", {
        method: "POST",
        body: JSON.stringify({
          clientRequestId,
          marketId: market?.id,
          quoteSymbol: quote.quoteSymbol,
          transactionHash: hash,
        }),
      });
      await refreshAccount();
      toast({
        kind: "success",
        title: `${market?.symbol ?? "Market"}/${quote.quoteSymbol} swap confirmed`,
        body: "The verified receipt is stored in your trade history.",
      });
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  if (!market || !route) return null;
  const busy = !["idle", "failed", "confirmed"].includes(state);
  return (
    <div className="border-t border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            Validated {config?.environment ?? "network"} execution
          </p>
          <h3 className="mt-2 flex items-center gap-2 text-lg text-fg">
            {market.symbol} <ArrowRightLeft className="size-4 text-lime" />{" "}
            {route.quoteSymbol}
          </h3>
          <p className="mt-1 font-mono text-[10px] uppercase text-faint">
            ZKBLAST DAMM · chain {config?.chainId ?? "—"} · 0.5% slippage
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            aria-label={`${market.symbol} amount`}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setQuote(null);
            }}
            inputMode="decimal"
            className="h-11 min-w-0 flex-1 border border-line bg-bg px-3 font-mono text-sm outline-none focus:border-lime sm:w-36"
          />
          <Button
            disabled={busy}
            onClick={() => void (quote ? submit() : requestQuote())}
          >
            {!address
              ? "Connect wallet"
              : busy
                ? state.replaceAll("-", " ")
                : quote
                  ? "Approve & swap"
                  : "Get quote"}
          </Button>
        </div>
      </div>
      {quote && (
        <p className="mt-3 font-mono text-xs text-muted">
          Raw output {quote.amountOut} · minimum {quote.minimumAmountOut}{" "}
          {quote.quoteSymbol}
        </p>
      )}
      {notice && <p className="mt-3 text-xs text-danger">{notice}</p>}
      {transactionHash && config && (
        <a
          href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-lime"
        >
          View receipt <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
