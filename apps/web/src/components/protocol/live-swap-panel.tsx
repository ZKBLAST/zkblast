"use client";

import { formatTokenAmount, parseTokenAmount } from "@zkblast/sdk";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api-client";
import {
  executeSwap,
  swapErrorMessage,
  type PreparedTransaction,
  type SwapExecutionState,
} from "../../lib/swap-flow";
import type { PublicConfig, UserProfile } from "../../types/application";
import { Badge, Panel } from "../ui/primitives";

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

export function LiveSwapPanel({
  apiUrl,
  config,
  profile,
  connect,
}: Readonly<{
  apiUrl: string;
  config: PublicConfig | null;
  profile: UserProfile | null;
  connect: () => void;
}>) {
  const [pools, setPools] = useState<readonly Pool[]>([]);
  const [poolAddress, setPoolAddress] = useState("");
  const [amount, setAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<
    SwapExecutionState | "idle" | "quoting" | "failed"
  >("idle");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const pool = useMemo(
    () => pools.find((item) => item.address === poolAddress) ?? pools[0],
    [poolAddress, pools],
  );
  const account = profile?.wallets[0]?.address;

  useEffect(() => {
    void apiRequest<{ items: Pool[] }>(apiUrl, "/v1/protocol/pools?limit=100")
      .then(({ items }) => {
        setPools(items);
        setPoolAddress(items[0]?.address ?? "");
      })
      .catch(() => setNotice("Pool index is temporarily unavailable."));
  }, [apiUrl]);

  async function requestQuote() {
    if (!account) return connect();
    if (!pool) return setNotice("No verified testnet pool is indexed yet.");
    setState("quoting");
    setNotice("");
    setTransactionHash("");
    try {
      const amountIn = parseTokenAmount(amount, pool.token0Decimals);
      const result = await apiRequest<Quote>(
        apiUrl,
        "/v1/protocol/swap/quote",
        {
          method: "POST",
          body: JSON.stringify({
            model: pool.model,
            pool: pool.address,
            tokenIn: pool.token0Address,
            amountIn: amountIn.toString(),
            slippageBps,
            recipient: account,
            deadline: String(Math.floor(Date.now() / 1000) + 1_200),
            token0ToToken1: true,
            maximumBinCrossings: 16,
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
    if (!quote || !account || !window.ethereum) return;
    try {
      const hash = await executeSwap(
        window.ethereum,
        account,
        quote.chainId,
        quote.approval,
        quote.swap,
        (next, transaction) => {
          setState(next);
          if (transaction) setTransactionHash(transaction);
        },
      );
      setTransactionHash(hash);
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  const busy = !["idle", "failed", "confirmed"].includes(state);
  return (
    <Panel className="swap-panel">
      <div className="panel-title">
        <h2>SWAP</h2>
        <Badge muted>PUBLIC AMM</Badge>
      </div>
      {pool ? (
        <>
          <label className="token-entry">
            <span>YOU PAY</span>
            <div>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setQuote(null);
                }}
              />
              <strong>{pool.token0Symbol}</strong>
            </div>
          </label>
          <label className="token-entry">
            <span>YOU RECEIVE</span>
            <div>
              <input
                readOnly
                value={
                  quote
                    ? formatTokenAmount(
                        BigInt(quote.amountOut),
                        pool.token1Decimals,
                      )
                    : "—"
                }
              />
              <strong>{pool.token1Symbol}</strong>
            </div>
          </label>
          <label className="token-entry">
            <span>VERIFIED POOL</span>
            <select
              value={pool.address}
              onChange={(event) => {
                setPoolAddress(event.target.value);
                setQuote(null);
              }}
            >
              {pools.map((item) => (
                <option value={item.address} key={item.address}>
                  {item.token0Symbol} / {item.token1Symbol} ·{" "}
                  {item.model.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="token-entry">
            <span>MAX SLIPPAGE (BPS)</span>
            <input
              type="number"
              min="0"
              max="10000"
              value={slippageBps}
              onChange={(event) => {
                setSlippageBps(Number(event.target.value));
                setQuote(null);
              }}
            />
          </label>
          {quote && (
            <div className="quote-details">
              <div>
                <span>Minimum received</span>
                <strong>
                  {formatTokenAmount(
                    BigInt(quote.minimumAmountOut),
                    pool.token1Decimals,
                  )}{" "}
                  {pool.token1Symbol}
                </strong>
              </div>
              <div>
                <span>Network</span>
                <strong>{config?.chainName ?? quote.chainId}</strong>
              </div>
            </div>
          )}
          <button
            className="button button-primary full-width"
            disabled={busy}
            onClick={() => void (quote ? submit() : requestQuote())}
          >
            {!account
              ? "CONNECT WALLET"
              : quote
                ? state === "confirmed"
                  ? "SWAP CONFIRMED"
                  : busy
                    ? state.toUpperCase().replace("-", " ")
                    : "APPROVE & SWAP"
                : state === "quoting"
                  ? "QUOTING…"
                  : "GET VERIFIED QUOTE"}
          </button>
        </>
      ) : (
        <div className="notice-box">
          No verified pool is indexed for this environment. The swap flow
          activates automatically after pool creation and indexing.
        </div>
      )}
      {notice && (
        <div className="notice-box" role="alert">
          {notice}
        </div>
      )}
      {transactionHash && config && (
        <a
          className="button button-secondary full-width"
          href={`${config.explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          VIEW RECEIPT
        </a>
      )}
      <p className="entry-disclaimer">
        Addresses and calldata come from the environment-bound API manifest. RPC
        and database credentials never enter the browser.
      </p>
    </Panel>
  );
}
