"use client";

import { formatTokenAmount, parseTokenAmount } from "@zkblast/sdk";
import { ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge, PairMark, TypeTag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { executeSwap, swapErrorMessage, type PreparedTransaction, type SwapExecutionState } from "@/lib/swap-flow";

type Pool = Readonly<{
  address: string;
  model: "damm" | "dlmm";
  token0Address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Address: string;
  token1Symbol: string;
  token1Decimals: number;
}>;

type Quote = Readonly<{
  chainId: number;
  amountOut: string;
  minimumAmountOut: string;
  approval: PreparedTransaction;
  swap: PreparedTransaction;
}>;

export function SwapCard({ onPair }: Readonly<{ onPair?: (from: string, to: string) => void }>) {
  const { address, config, connect, refreshAccount, toast } = useApp();
  const [pools, setPools] = useState<readonly Pool[]>([]);
  const [poolAddress, setPoolAddress] = useState("");
  const [amount, setAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<SwapExecutionState | "idle" | "quoting" | "failed">("idle");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const pool = useMemo(() => pools.find((item) => item.address === poolAddress) ?? pools[0], [poolAddress, pools]);

  useEffect(() => {
    void apiRequest<{ items: Pool[] }>(webPublicConfig.apiUrl, "/v1/protocol/pools?limit=100")
      .then(({ items }) => {
        setPools(items);
        setPoolAddress(items[0]?.address ?? "");
      })
      .catch(() => setNotice("Verified pool index is temporarily unavailable."));
  }, []);

  useEffect(() => {
    if (pool) onPair?.(pool.token0Symbol, pool.token1Symbol);
  }, [onPair, pool]);

  async function requestQuote() {
    if (!address) return connect();
    if (!pool) return setNotice("No verified pool is indexed for this environment.");
    setState("quoting");
    setNotice("");
    setTransactionHash("");
    try {
      const result = await apiRequest<Quote>(webPublicConfig.apiUrl, "/v1/protocol/swap/quote", {
        method: "POST",
        body: JSON.stringify({
          model: pool.model,
          pool: pool.address,
          tokenIn: pool.token0Address,
          amountIn: parseTokenAmount(amount, pool.token0Decimals).toString(),
          slippageBps,
          recipient: address,
          deadline: String(Math.floor(Date.now() / 1_000) + 1_200),
          token0ToToken1: true,
          maximumBinCrossings: 16,
        }),
      });
      setQuote(result);
      setState("idle");
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  async function submit() {
    if (!quote || !address || !window.ethereum) return;
    setNotice("");
    try {
      const hash = await executeSwap(window.ethereum, address, quote.chainId, quote.approval, quote.swap, (next, transaction) => {
        setState(next);
        if (transaction) setTransactionHash(transaction);
      });
      setTransactionHash(hash);
      await refreshAccount();
      toast({ kind: "success", title: "Swap confirmed", body: "The transaction is recorded in your ZKBLAST trade history." });
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  const busy = !["idle", "failed", "confirmed"].includes(state);
  const buttonLabel = !address
    ? "Connect wallet"
    : quote
      ? state === "confirmed"
        ? "Swap confirmed"
        : busy
          ? state.replaceAll("-", " ")
          : "Approve and swap"
      : state === "quoting"
        ? "Requesting verified quote"
        : "Get verified quote";

  return (
    <section className="panel ticks" aria-label="Live swap execution">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <LaneBadge lane="public" />
        <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted">
          <Settings2 className="size-4" aria-hidden /> {slippageBps / 100}% slippage
        </span>
      </div>
      <div className="space-y-3 p-5">
        {pool ? (
          <>
            <label className="block">
              <span className="label">Verified pool</span>
              <select
                value={pool.address}
                onChange={(event) => {
                  setPoolAddress(event.target.value);
                  setQuote(null);
                }}
                className="mt-2 h-12 w-full border border-line bg-bg px-3 font-mono text-sm outline-none focus:border-lime"
              >
                {pools.map((item) => (
                  <option key={item.address} value={item.address}>
                    {item.token0Symbol} / {item.token1Symbol} · {item.model.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-md border border-line bg-bg p-4">
              <div className="flex items-center justify-between">
                <span className="label">You pay</span>
                <PairMark base={pool.token0Symbol} quote={pool.token1Symbol} size={24} />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  aria-label={`Amount of ${pool.token0Symbol}`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setQuote(null);
                  }}
                  className="num min-w-0 flex-1 bg-transparent text-[30px] outline-none"
                />
                <strong>{pool.token0Symbol}</strong>
              </div>
            </div>
            <div className="rounded-md border border-line bg-bg p-4">
              <span className="label">You receive</span>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="num text-[30px]">
                  {quote ? formatTokenAmount(BigInt(quote.amountOut), pool.token1Decimals) : "—"}
                </span>
                <strong>{pool.token1Symbol}</strong>
              </div>
            </div>
            <label className="block">
              <span className="label">Maximum slippage in basis points</span>
              <input
                type="number"
                min="0"
                max="10000"
                value={slippageBps}
                onChange={(event) => {
                  setSlippageBps(Number(event.target.value));
                  setQuote(null);
                }}
                className="num mt-2 h-11 w-full border border-line bg-bg px-3 outline-none focus:border-lime"
              />
            </label>
            {quote && (
              <dl className="space-y-2 border-y border-line py-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-faint">Minimum received</dt><dd className="num text-right">{formatTokenAmount(BigInt(quote.minimumAmountOut), pool.token1Decimals)} {pool.token1Symbol}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-faint">Execution network</dt><dd className="text-right">{config?.chainName ?? quote.chainId}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-faint">Pool model</dt><dd><TypeTag type={pool.model.toUpperCase() as "DAMM" | "DLMM"} /></dd></div>
              </dl>
            )}
            <Button size="lg" className="w-full capitalize" disabled={busy} onClick={() => void (quote ? submit() : requestQuote())}>
              {busy && <RefreshCw className="size-4 animate-spin" aria-hidden />}
              {buttonLabel}
            </Button>
          </>
        ) : (
          <p className="rounded-md border border-line p-4 text-sm text-muted">No verified pool is available yet. Start the API and indexer, then refresh this page.</p>
        )}
        {notice && <p role="alert" className="rounded-md border border-danger/40 p-3 text-sm text-danger">{notice}</p>}
        {transactionHash && config && (
          <a href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-mono text-xs uppercase text-lime hover:underline">
            View transaction receipt <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        <p className="text-[12px] text-faint">Contract addresses and calldata come from the environment-bound API. RPC and Supabase credentials never enter the browser.</p>
      </div>
    </section>
  );
}
