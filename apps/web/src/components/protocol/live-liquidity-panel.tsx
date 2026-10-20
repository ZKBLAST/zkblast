"use client";

import { parseTokenAmount } from "@zkblast/sdk";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api-client";
import {
  executeTransactions,
  swapErrorMessage,
  type PreparedTransaction,
  type TransactionExecutionState,
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
type PreparedLiquidity = Readonly<{
  chainId: number;
  approvals: readonly PreparedTransaction[];
  position: PreparedTransaction;
}>;
type PreparedAction = Readonly<{
  chainId: number;
  position: PreparedTransaction;
}>;
type PreparedClaim = Readonly<{
  chainId: number;
  eligible: boolean;
  claim: PreparedTransaction | null;
}>;

export function LiveLiquidityPanel({
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
  const [amount0, setAmount0] = useState("1");
  const [amount1, setAmount1] = useState("1");
  const [positionId, setPositionId] = useState("");
  const [shares, setShares] = useState("");
  const [state, setState] = useState<
    TransactionExecutionState | "idle" | "preparing" | "failed"
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

  async function createPosition() {
    if (!account) return connect();
    if (!pool || !window.ethereum)
      return setNotice("No verified pool is available.");
    setState("preparing");
    setNotice("");
    try {
      const prepared = await apiRequest<PreparedLiquidity>(
        apiUrl,
        "/v1/protocol/liquidity/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            model: pool.model,
            pool: pool.address,
            token0: pool.token0Address,
            token1: pool.token1Address,
            amount0: parseTokenAmount(amount0, pool.token0Decimals).toString(),
            amount1: parseTokenAmount(amount1, pool.token1Decimals).toString(),
            minimumShares: "0",
            deadline: String(Math.floor(Date.now() / 1000) + 1_200),
          }),
        },
      );
      const hash = await executeTransactions(
        window.ethereum,
        account,
        prepared.chainId,
        [...prepared.approvals, prepared.position],
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

  async function removeLiquidity() {
    if (!account) return connect();
    if (!window.ethereum) return;
    setState("preparing");
    setNotice("");
    try {
      const prepared = await apiRequest<PreparedAction>(
        apiUrl,
        "/v1/protocol/positions/decrease",
        {
          method: "POST",
          body: JSON.stringify({
            owner: account,
            positionId,
            shares,
            minimumAmount0: "0",
            minimumAmount1: "0",
            recipient: account,
            deadline: String(Math.floor(Date.now() / 1000) + 1_200),
          }),
        },
      );
      await run([prepared.position], prepared.chainId);
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  async function claimFees() {
    if (!account) return connect();
    if (!pool || !window.ethereum) return;
    setState("preparing");
    setNotice("");
    try {
      const prepared = await apiRequest<PreparedClaim>(
        apiUrl,
        "/v1/protocol/fees/prepare-claim",
        {
          method: "POST",
          body: JSON.stringify({
            model: pool.model,
            pool: pool.address,
            wallet: account,
          }),
        },
      );
      if (!prepared.eligible || !prepared.claim) {
        setState("idle");
        setNotice(
          "Connected wallet is not the onchain protocol fee recipient.",
        );
        return;
      }
      await run([prepared.claim], prepared.chainId);
    } catch (error) {
      setState("failed");
      setNotice(swapErrorMessage(error));
    }
  }

  async function run(
    transactions: readonly PreparedTransaction[],
    chainId: number,
  ) {
    if (!account || !window.ethereum) return;
    const hash = await executeTransactions(
      window.ethereum,
      account,
      chainId,
      transactions,
      (next, transaction) => {
        setState(next);
        if (transaction) setTransactionHash(transaction);
      },
    );
    setTransactionHash(hash);
  }

  const busy = !["idle", "failed", "confirmed"].includes(state);
  return (
    <Panel className="position-builder">
      <div className="panel-title">
        <h2>Live position</h2>
        <Badge>VERIFIED CONTRACTS</Badge>
      </div>
      {pool ? (
        <>
          <label>
            POOL
            <select
              value={pool.address}
              onChange={(event) => setPoolAddress(event.target.value)}
            >
              {pools.map((item) => (
                <option key={item.address} value={item.address}>
                  {item.token0Symbol} / {item.token1Symbol} ·{" "}
                  {item.model.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            {pool.token0Symbol}
            <input
              inputMode="decimal"
              value={amount0}
              onChange={(event) => setAmount0(event.target.value)}
            />
          </label>
          <label>
            {pool.token1Symbol}
            <input
              inputMode="decimal"
              value={amount1}
              onChange={(event) => setAmount1(event.target.value)}
            />
          </label>
          <button
            className="button button-primary full-width"
            disabled={busy}
            onClick={() => void createPosition()}
          >
            {!account
              ? "CONNECT WALLET"
              : state === "confirmed"
                ? "POSITION CONFIRMED"
                : busy
                  ? state.toUpperCase().replace("-", " ")
                  : "APPROVE & CREATE POSITION"}
          </button>
          <div className="panel-title">
            <h2>Manage position</h2>
            <Badge muted>OWNER ONLY</Badge>
          </div>
          <label>
            POSITION ID
            <input
              inputMode="numeric"
              value={positionId}
              onChange={(event) => setPositionId(event.target.value)}
            />
          </label>
          <label>
            SHARES TO REMOVE
            <input
              inputMode="numeric"
              value={shares}
              onChange={(event) => setShares(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary full-width"
            disabled={busy || !positionId || !shares}
            onClick={() => void removeLiquidity()}
          >
            REMOVE LIQUIDITY
          </button>
          <button
            className="button button-secondary full-width"
            disabled={busy}
            onClick={() => void claimFees()}
          >
            CHECK &amp; CLAIM PROTOCOL FEES
          </button>
        </>
      ) : (
        <div className="notice-box">
          No verified pool is indexed for this environment.
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
        Approvals and position calldata are produced by the API from the active
        environment manifest. Private RPC and database settings stay
        server-side.
      </p>
    </Panel>
  );
}
