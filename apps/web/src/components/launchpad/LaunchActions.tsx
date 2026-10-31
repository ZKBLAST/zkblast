"use client";
import {
  ArrowDownUp,
  Coins,
  Copy,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
} from "viem";
import type { DbcAddresses } from "@zkblast/sdk";
import { AssetLogo } from "@/components/markets/AssetLogo";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import {
  parseTokenAmount,
  formatTokenAmount,
  minimumAmountOut,
} from "@zkblast/sdk";
import {
  approvalTransaction,
  contractCallTransaction,
  dbcClient,
  executeDbcTransactions,
  type DbcQuoteResponse,
} from "@/lib/dbc-transactions";
import type { DbcGraduation, DbcLaunch, TemplateEconomics } from "./types";

type Tab = "trade" | "graduation" | "claims";
export function LaunchActions({
  launch,
  deployment,
  onComplete,
}: {
  launch: DbcLaunch;
  deployment: DbcAddresses;
  onComplete: () => void;
}) {
  const { address, config, connect, toast } = useApp();
  const [tab, setTab] = useState<Tab>("trade");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [quote, setQuote] = useState<DbcQuoteResponse | null>(null);
  const [quoteAt, setQuoteAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [graduation, setGraduation] = useState<DbcGraduation | null>(null);
  const [economics, setEconomics] = useState<TemplateEconomics | null>(null);
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [allowanceRaw, setAllowanceRaw] = useState<bigint | null>(null);
  const [executableMaxRaw, setExecutableMaxRaw] = useState<bigint | null>(null);
  const symbol = launch.symbol ?? "TOKEN";
  const tokenLogoUrl =
    launch.has_logo && launch.metadata_id
      ? `/api/v1/dbc/metadata/${launch.metadata_id}/logo`
      : `/asset-logo/${symbol}`;
  const inputDecimals = side === "buy" ? 6 : 18;
  const outputDecimals = side === "buy" ? 18 : 6;
  useEffect(() => {
    setQuote(null);
    setQuoteAt(0);
    setAmount("");
    setExecutableMaxRaw(null);
  }, [launch.launch_id, side]);
  useEffect(() => {
    setExecutableMaxRaw(null);
  }, [launch.base_sold_raw, launch.real_quote_reserve_raw]);
  useEffect(() => {
    if (launch.lifecycle !== 4) {
      setGraduation(null);
      return;
    }
    void apiRequest<DbcGraduation>(
      webPublicConfig.apiUrl,
      `/v1/dbc/launches/${launch.launch_id}/graduation`,
    )
      .then(setGraduation)
      .catch(() => setGraduation(null));
  }, [launch.launch_id, launch.lifecycle]);
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<TemplateEconomics>(
      webPublicConfig.apiUrl,
      `/v1/dbc/templates/${launch.template_id}/economics`,
      { signal: controller.signal },
    )
      .then(setEconomics)
      .catch(() => setEconomics(null));
    return () => controller.abort();
  }, [launch.template_id]);
  useEffect(() => {
    if (!address || !window.ethereum) {
      setBalanceRaw(null);
      setAllowanceRaw(null);
      return;
    }
    let cancelled = false;
    const token = getAddress(
      side === "buy" ? launch.quote_token : launch.token_address,
    );
    const owner = getAddress(address);
    const pool = getAddress(launch.virtual_pool);
    async function callToken(data: `0x${string}`) {
      return window.ethereum!.request({
        method: "eth_call",
        params: [{ to: token, data }, "latest"],
      });
    }
    async function readBalance() {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      });
      const result = await callToken(data);
      return decodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        data: result as `0x${string}`,
      });
    }
    async function readAllowance() {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, pool],
      });
      const result = await callToken(data);
      return decodeFunctionResult({
        abi: erc20Abi,
        functionName: "allowance",
        data: result as `0x${string}`,
      });
    }
    void Promise.all([readBalance(), readAllowance()])
      .then(([balance, allowance]) => {
        if (!cancelled) {
          setBalanceRaw(balance);
          setAllowanceRaw(allowance);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBalanceRaw(null);
          setAllowanceRaw(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    address,
    launch.quote_token,
    launch.token_address,
    launch.updated_block,
    launch.virtual_pool,
    side,
  ]);
  const outputRaw = quote
    ? side === "buy"
      ? quote.baseOutRaw
      : quote.netQuoteOutRaw
    : undefined;
  const output = useMemo(
    () =>
      outputRaw ? formatTokenAmount(BigInt(outputRaw), outputDecimals) : "—",
    [outputRaw, outputDecimals],
  );
  const amountRaw = useMemo(() => {
    try {
      return amount ? parseTokenAmount(amount, inputDecimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, inputDecimals]);
  const spendableRaw = useMemo(() => {
    if (balanceRaw === null) return null;
    if (side === "buy") return balanceRaw;
    const curveSellable = BigInt(launch.base_sold_raw);
    return balanceRaw < curveSellable ? balanceRaw : curveSellable;
  }, [balanceRaw, launch.base_sold_raw, side]);
  const priceImpactBps = useMemo(() => {
    if (!quote || !outputRaw || amountRaw === 0n) return null;
    const quoteRaw = side === "buy" ? amountRaw : BigInt(outputRaw);
    const baseRaw = side === "buy" ? BigInt(outputRaw) : amountRaw;
    if (baseRaw === 0n) return null;
    const averageX18 = (quoteRaw * 10n ** 30n) / baseRaw;
    const finalX18 = BigInt(quote.finalPriceX18);
    return Number(
      ((finalX18 > averageX18 ? finalX18 - averageX18 : averageX18 - finalX18) *
        10_000n) /
        averageX18,
    );
  }, [amountRaw, outputRaw, quote, side]);
  const getQuote = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const raw = parseTokenAmount(amount, inputDecimals);
        if (raw <= 0n) throw new Error("INVALID_AMOUNT");
        if (spendableRaw !== null && raw > spendableRaw)
          throw new Error(
            side === "sell"
              ? "AMOUNT_EXCEEDS_CURVE_SELLABLE_BALANCE"
              : "INSUFFICIENT_TOKEN_BALANCE",
          );
        setBusy(true);
        setStatus("Requesting fresh quote");
        const result = await apiRequest<DbcQuoteResponse>(
          webPublicConfig.apiUrl,
          "/v1/dbc/quote",
          {
            method: "POST",
            signal,
            body: JSON.stringify({
              pool: launch.virtual_pool,
              side,
              amountRaw: raw.toString(),
            }),
          },
        );
        setQuote(result);
        setQuoteAt(Date.now());
        setStatus("");
      } catch (error) {
        if (signal?.aborted) return;
        setStatus(error instanceof Error ? error.message : "QUOTE_FAILED");
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [amount, inputDecimals, launch.virtual_pool, side, spendableRaw],
  );
  useEffect(() => {
    if (!amount || amountRaw <= 0n || launch.lifecycle !== 1) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void getQuote(controller.signal),
      400,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [amount, amountRaw, getQuote, launch.lifecycle]);
  async function applyPercentage(percent: number) {
    if (spendableRaw === null) return;
    let raw = (spendableRaw * BigInt(percent)) / 100n;
    if (side === "sell" && percent === 100 && raw > 0n) {
      setBusy(true);
      setStatus("Calculating maximum executable sell");
      try {
        let low = 0n;
        let high = raw;
        const reserve = BigInt(launch.real_quote_reserve_raw);
        for (let index = 0; index < 12 && low < high; index++) {
          const middle = (low + high + 1n) / 2n;
          const result = await apiRequest<DbcQuoteResponse>(
            webPublicConfig.apiUrl,
            "/v1/dbc/quote",
            {
              method: "POST",
              body: JSON.stringify({
                pool: launch.virtual_pool,
                side: "sell",
                amountRaw: middle.toString(),
              }),
            },
          );
          if (BigInt(result.grossQuoteOutRaw ?? "0") <= reserve) low = middle;
          else high = middle - 1n;
        }
        raw = low;
        setExecutableMaxRaw(low);
        setStatus("");
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "MAX_SELL_QUOTE_FAILED",
        );
      } finally {
        setBusy(false);
      }
    }
    setAmount(formatTokenAmount(raw, inputDecimals));
    setQuote(null);
  }
  async function executeTrade() {
    if (!address) return connect();
    if (!window.ethereum || !config || !quote || !outputRaw) return;
    setBusy(true);
    try {
      if (Date.now() - quoteAt > 60_000)
        throw new Error("QUOTE_EXPIRED_REFRESH_REQUIRED");
      const client = dbcClient(deployment);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const raw = parseTokenAmount(amount, inputDecimals);
      if (spendableRaw !== null && raw > spendableRaw)
        throw new Error(
          side === "sell"
            ? "AMOUNT_EXCEEDS_CURVE_SELLABLE_BALANCE"
            : "INSUFFICIENT_TOKEN_BALANCE",
        );
      const minimum = minimumAmountOut(BigInt(outputRaw), slippage);
      const tokenIn = getAddress(
        side === "buy" ? launch.quote_token : launch.token_address,
      );
      const calls =
        allowanceRaw !== null && allowanceRaw >= raw
          ? []
          : [
              approvalTransaction(
                tokenIn,
                getAddress(launch.virtual_pool),
                raw,
              ),
            ];
      calls.push(
        contractCallTransaction(
          side === "buy"
            ? client.buyExactInput({
                pool: getAddress(launch.virtual_pool),
                grossQuoteInRaw: raw,
                minimumBaseOutRaw: minimum,
                maximumPriceX18:
                  (BigInt(quote.finalPriceX18) * (10_000n + BigInt(slippage))) /
                  10_000n,
                recipient: getAddress(address),
                deadline,
              })
            : client.sellExactInput({
                pool: getAddress(launch.virtual_pool),
                baseInRaw: raw,
                minimumQuoteOutRaw: minimum,
                minimumPriceX18:
                  (BigInt(quote.finalPriceX18) * (10_000n - BigInt(slippage))) /
                  10_000n,
                recipient: getAddress(address),
                deadline,
              }),
        ),
      );
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls,
        action: `Curve ${side}`,
        onStatus: setStatus,
      });
      toast({
        kind: "success",
        title: `${side === "buy" ? "Buy" : "Sell"} confirmed`,
        body: "Chart and graduation progress update after indexer finality.",
      });
      setQuote(null);
      setQuoteAt(0);
      setAmount("");
      onComplete();
      window.setTimeout(onComplete, 4_000);
      window.setTimeout(onComplete, 10_000);
      window.setTimeout(onComplete, 20_000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "TRADE_FAILED");
    } finally {
      setBusy(false);
    }
  }
  async function executeSimple(
    action: "graduate" | "creatorFee" | "protocolFee" | "lp",
    creatorAllocation = false,
  ) {
    if (!address) return connect();
    if (!window.ethereum || !config) return;
    setBusy(true);
    try {
      const client = dbcClient(deployment);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const call =
        action === "graduate"
          ? client.graduate(getAddress(launch.virtual_pool), deadline)
          : action === "lp" && graduation
            ? client.claimLp(
                graduation.migration_id as `0x${string}`,
                creatorAllocation,
                deadline,
              )
            : client.claimFees(
                getAddress(launch.virtual_pool),
                action === "creatorFee" ? 0 : 2,
              );
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [contractCallTransaction(call)],
        action:
          action === "graduate"
            ? "Curve graduation"
            : action === "lp"
              ? "LP allocation claim"
              : "Launch fee claim",
        onStatus: setStatus,
      });
      toast({ kind: "success", title: "Transaction confirmed" });
      onComplete();
      window.setTimeout(onComplete, 4_000);
      window.setTimeout(onComplete, 10_000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "TRANSACTION_FAILED");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="flex min-h-[36rem] flex-col border-l border-line bg-[#0d0d17]">
      <div className="grid grid-cols-3 border-b border-line">
        {(["trade", "graduation", "claims"] as Tab[]).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`min-h-12 border-b-2 px-2 font-mono text-[10px] uppercase ${tab === value ? "border-lime bg-white/[.04] text-fg" : "border-transparent text-muted"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="flex-1 p-4 sm:p-5">
        {tab === "trade" && (
          <>
            <p className="label">Public curve execution</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex -space-x-2">
                <AssetLogo url={tokenLogoUrl} label={symbol} />
                <AssetLogo url="/asset-logo/USDG" label="USDG" />
              </div>
              <div>
                <p className="font-mono text-sm">{symbol}/USDG</p>
                <p className="text-xs text-muted">
                  Bonding curve · template {launch.template_id}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 border border-line p-1">
              <button
                onClick={() => setSide("buy")}
                className={`py-2 text-xs ${side === "buy" ? "bg-lime text-lime-ink" : "text-muted"}`}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={`py-2 text-xs ${side === "sell" ? "bg-lime text-lime-ink" : "text-muted"}`}
              >
                Sell
              </button>
            </div>
            <label className="mt-4 block">
              <span className="flex justify-between text-xs text-muted">
                <span>You pay</span>
                <span>{side === "buy" ? "USDG" : symbol}</span>
              </span>
              <input
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setQuote(null);
                  setStatus("");
                }}
                inputMode="decimal"
                placeholder="0.0"
                className="mt-2 h-14 w-full border border-line bg-bg px-3 font-mono text-lg outline-none focus:border-lime/70"
              />
              <span className="mt-2 grid grid-cols-4 gap-2">
                {[25, 50, 75, 100].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    disabled={spendableRaw === null || spendableRaw === 0n}
                    onClick={() => void applyPercentage(percent)}
                    className="border border-line py-2 font-mono text-[10px] text-muted hover:border-lime/60 hover:text-fg disabled:opacity-30"
                  >
                    {percent === 100 ? "MAX" : `${percent}%`}
                  </button>
                ))}
              </span>
              {side === "sell" &&
                balanceRaw !== null &&
                spendableRaw !== null &&
                balanceRaw > spendableRaw && (
                  <span className="mt-2 block text-[10px] leading-4 text-muted">
                    MAX follows current curve demand. Creator allocation cannot
                    be sold before matching curve demand exists.
                  </span>
                )}
            </label>
            <div className="my-3 grid place-items-center">
              <ArrowDownUp className="size-4 text-muted" />
            </div>
            <div className="border border-line bg-bg p-3">
              <p className="text-xs text-muted">You receive</p>
              <p className="mt-2 break-all font-mono text-lg">
                {output}{" "}
                <span className="text-xs">
                  {side === "buy" ? symbol : "USDG"}
                </span>
              </p>
            </div>
            <label className="mt-4 flex items-center justify-between text-xs text-muted">
              <span>Slippage</span>
              <select
                value={slippage}
                onChange={(event) => setSlippage(Number(event.target.value))}
                className="border border-line bg-bg px-3 py-2 outline-none"
              >
                <option value={50}>0.5%</option>
                <option value={100}>1%</option>
                <option value={200}>2%</option>
              </select>
            </label>
            <button
              disabled={busy || !amount || launch.lifecycle !== 1}
              onClick={() => void (quote ? executeTrade() : getQuote())}
              className="mt-5 flex w-full items-center justify-center gap-2 bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {!address
                ? "Connect wallet"
                : launch.lifecycle !== 1
                  ? "Curve trading closed"
                  : quote
                    ? `Confirm ${side}`
                    : busy
                      ? "Calculating quote"
                      : "Refresh quote"}
            </button>
          </>
        )}
        {tab === "graduation" && (
          <>
            <GraduationCap className="size-7 text-lime" />
            <h2 className="mt-3 text-xl">DAMM graduation</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              At 100%, the curve freezes and anyone can migrate its bounded
              reserves into the configured DAMM pool. Recipients and LP policy
              cannot be changed by the caller.
            </p>
            <div className="mt-5 border border-line p-4">
              <p className="label">Progress</p>
              <div className="mt-3 h-2 overflow-hidden bg-raised">
                <span
                  className="block h-full bg-lime"
                  style={{
                    width: `${Math.min(100, launch.progress_bps / 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 font-mono text-sm">
                {(launch.progress_bps / 100).toFixed(2)}%
              </p>
            </div>
            {graduation ? (
              <a
                href={`${config?.explorerUrl}/address/${graduation.destination_pool}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center justify-between border border-line p-3 text-xs"
              >
                Destination pool <ExternalLink className="size-4" />
              </a>
            ) : (
              <button
                disabled={busy || launch.lifecycle !== 3}
                onClick={() => void executeSimple("graduate")}
                className="mt-4 w-full bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
              >
                {launch.lifecycle === 3
                  ? "Graduate to DAMM"
                  : "Waiting for threshold"}
              </button>
            )}
          </>
        )}
        {tab === "claims" && (
          <>
            <Coins className="size-7 text-lime" />
            <h2 className="mt-3 text-xl">Fees and LP allocation</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Claims always pay the recipients fixed by the launch template and
              graduation record.
            </p>
            {economics && (
              <div className="mt-4 grid grid-cols-2 gap-px bg-line text-[10px]">
                <Metric
                  label="Trade fee"
                  value={`${economics.tradeFeeBps / 100}%`}
                />
                <Metric
                  label="DAMM fee"
                  value={`${economics.destinationFeePips / 10_000}%`}
                />
                <Metric
                  label="Creator share"
                  value={`${economics.creatorFeeShareBps / 100}%`}
                />
                <Metric
                  label="Partner share"
                  value={`${economics.partnerFeeShareBps / 100}%`}
                />
                <Metric
                  label="Protocol share"
                  value={`${economics.protocolFeeShareBps / 100}%`}
                />
                <Metric
                  label="Creator LP"
                  value={`${economics.creatorLpShareBps / 100}%`}
                />
              </div>
            )}
            <div className="mt-5 grid gap-2">
              <button
                disabled={
                  busy ||
                  !address ||
                  address.toLowerCase() !== launch.creator.toLowerCase() ||
                  BigInt(launch.creator_claimable_raw ?? "0") === 0n
                }
                onClick={() => void executeSimple("creatorFee")}
                className="border border-line p-3 text-left text-xs hover:border-lime/60"
              >
                Claim creator fees ·{" "}
                {formatTokenAmount(
                  BigInt(launch.creator_claimable_raw ?? "0"),
                  6,
                )}{" "}
                USDG
              </button>
              <button
                disabled={
                  busy || BigInt(launch.protocol_claimable_raw ?? "0") === 0n
                }
                onClick={() => void executeSimple("protocolFee")}
                className="border border-line p-3 text-left text-xs hover:border-lime/60"
              >
                Trigger protocol payout ·{" "}
                {formatTokenAmount(
                  BigInt(launch.protocol_claimable_raw ?? "0"),
                  6,
                )}{" "}
                USDG
              </button>
              {graduation?.allocations.map((allocation) => (
                <button
                  key={allocation.allocation_kind}
                  disabled={busy || allocation.claimed}
                  onClick={() =>
                    void executeSimple(
                      "lp",
                      allocation.allocation_kind === "creator",
                    )
                  }
                  className="border border-line p-3 text-left text-xs disabled:opacity-40"
                >
                  {allocation.claimed
                    ? "Claimed"
                    : `Claim ${allocation.allocation_kind} LP`}{" "}
                  · {allocation.shares_raw} shares
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "trade" && address && (
          <div className="mt-4 grid grid-cols-2 gap-px bg-line text-[10px]">
            <Metric
              label="Wallet balance"
              value={
                balanceRaw === null
                  ? "Unavailable"
                  : `${formatTokenAmount(balanceRaw, inputDecimals)} ${side === "buy" ? "USDG" : symbol}`
              }
            />
            {side === "sell" && (
              <>
                <Metric
                  label="Curve capacity"
                  value={
                    spendableRaw === null
                      ? "Unavailable"
                      : `${formatTokenAmount(spendableRaw, 18)} ${symbol}`
                  }
                />
                <Metric
                  label="Executable MAX"
                  value={
                    executableMaxRaw === null
                      ? "Press MAX to calculate"
                      : `${formatTokenAmount(executableMaxRaw, 18)} ${symbol}`
                  }
                />
              </>
            )}
            <Metric
              label="Allowance"
              value={
                allowanceRaw === null
                  ? "Unavailable"
                  : allowanceRaw >= amountRaw
                    ? "Ready"
                    : "Approval required"
              }
            />
            {quote && (
              <>
                <Metric
                  label="Price impact"
                  value={priceImpactLabel(priceImpactBps)}
                />
                <Metric
                  label="Quote freshness"
                  value={
                    Date.now() - quoteAt <= 60_000
                      ? "Fresh · 60s limit"
                      : "Refresh required"
                  }
                />
              </>
            )}
          </div>
        )}
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <ContractRow
            label="Token contract"
            value={launch.token_address}
            explorer={config?.explorerUrl}
          />
          <ContractRow
            label="Virtual pool"
            value={launch.virtual_pool}
            explorer={config?.explorerUrl}
          />
        </div>
        {status && (
          <p
            role="status"
            className="mt-4 break-words border border-line p-3 text-xs text-muted"
          >
            {status}
          </p>
        )}
      </div>
    </aside>
  );
}
function priceImpactLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${(value / 100).toFixed(2)}%`;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-3">
      <p className="text-muted">{label}</p>
      <p className="mt-1 break-all font-mono text-fg">{value}</p>
    </div>
  );
}
function ContractRow({
  label,
  value,
  explorer,
}: {
  label: string;
  value: string;
  explorer?: string;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 break-all font-mono text-[10px]">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value)}
          className="shrink-0 border border-line p-1.5 text-muted hover:text-fg"
        >
          <Copy className="size-3" />
        </button>
        {explorer && (
          <a
            aria-label={`Open ${label} in explorer`}
            href={`${explorer}/address/${value}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 border border-line p-1.5 text-muted hover:text-fg"
          >
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}
