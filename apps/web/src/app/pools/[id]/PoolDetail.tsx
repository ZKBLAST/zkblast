"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { BinChart, type Shape } from "@/components/pools/BinChart";
import { useApp } from "@/components/shell/AppProvider";
import { LaneBadge, TokenMark, TypeTag } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Stat } from "@/components/ui/PageHeader";
import { Reveal } from "@/components/ui/Reveal";
import { Segmented } from "@/components/ui/Segmented";
import { TxSteps, type StepState } from "@/components/swap/TxSteps";
import { binsFor, poolById, priceHistory } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";
import { fmtAmount, fmtPrice, fmtUsd, fmtUsdCompact, cx } from "@/lib/format";
import { useExternalMarkets } from "@/lib/use-external-markets";

export function PoolDetail({ id }: { id: string }) {
  const pool = poolById(id)!;
  const { address, balances, connect, adjust, toast } = useApp();
  const { items: externalMarkets } = useExternalMarkets();
  const bins = useMemo(() => (pool.type === "DLMM" ? binsFor(pool, 34) : []), [pool]);
  const hist = useMemo(() => priceHistory(pool, 96), [pool]);
  const [lo, setLo] = useState(-10);
  const [hi, setHi] = useState(10);
  const [shape, setShape] = useState<Shape>("Spot");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [tx, setTx] = useState<number | null>(null);

  const base = tokenBySymbol(pool.base), quote = tokenBySymbol(pool.quote);
  const amtA = parseFloat(a) || 0, amtB = parseFloat(b) || 0;
  // Ranges entirely above price take only base; entirely below take only quote.
  const needsBase = pool.type === "DAMM" || hi >= 0;
  const needsQuote = pool.type === "DAMM" || lo <= 0;
  const overA = !!address && amtA > (balances[pool.base] ?? 0);
  const overB = !!address && amtB > (balances[pool.quote] ?? 0);
  const total = amtA * base.priceUsd + amtB * quote.priceUsd;
  const lowPrice = bins.find((x) => x.offset === lo)?.price;
  const highPrice = bins.find((x) => x.offset === hi)?.price;

  const onA = (v: string) => { const c = v.replace(/[^0-9.]/g, ""); setA(c); if (pool.type === "DAMM" || (lo < 0 && hi > 0)) { const n = parseFloat(c) || 0; setB(n ? String(+(n * pool.price).toFixed(6)) : ""); } };
  const onB = (v: string) => { const c = v.replace(/[^0-9.]/g, ""); setB(c); if (pool.type === "DAMM" || (lo < 0 && hi > 0)) { const n = parseFloat(c) || 0; setA(n ? String(+(n / pool.price).toFixed(8)) : ""); } };

  const submit = () => {
    setTx(0);
    setTimeout(() => setTx(1), 1100);
    setTimeout(() => setTx(2), 2300);
    setTimeout(() => {
      setTx(3);
      adjust(pool.base, -amtA); adjust(pool.quote, -amtB);
      toast({ kind: "success", title: "Liquidity added", body: `${fmtUsd(total)} into ${pool.base}/${pool.quote} (simulated)` });
    }, 3500);
  };
  const st = (i: number): StepState => (tx === null ? "idle" : tx > i ? "done" : tx === i ? "active" : "idle");
  const disabled = !address ? false : total <= 0 || overA || overB;
  const cta = !address ? "Connect wallet" : total <= 0 ? "Enter an amount" : overA ? `Not enough ${pool.base}` : overB ? `Not enough ${pool.quote}` : "Add liquidity";

  return (
    <div className="mx-auto max-w-[1360px] px-4 pt-[calc(var(--header-h)+2rem)] sm:px-6">
      <Link href="/pools" className="inline-flex h-10 items-center gap-2 text-[14px] text-muted transition-colors hover:text-fg"><ArrowLeft className="size-4" aria-hidden /> All pools</Link>

      <Reveal>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <ProtocolPairLogo
            base={pool.base}
            quote={pool.quote}
            markets={externalMarkets}
          />
          <h1 className="display text-[clamp(2.4rem,6vw,4.8rem)]">{pool.base}/{pool.quote}</h1>
          <div className="flex flex-wrap gap-2"><TypeTag type={pool.type} /><LaneBadge lane="public" /></div>
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="TVL" value={fmtUsdCompact(pool.tvlUsd)} />
          <Stat label="Volume 24h" value={fmtUsdCompact(pool.volume24hUsd)} />
          <Stat label="Fees 24h" value={fmtUsdCompact(pool.fees24hUsd)} />
          <Stat label="APR 7d" value={<span className="text-lime">{pool.apr.toFixed(2)}%</span>} />
          <Stat label="Base fee" value={`${(pool.feeBps / 100).toFixed(2)}%`} />
          <Stat label={pool.type === "DLMM" ? "Bin step" : "Curve"} value={pool.type === "DLMM" ? `${pool.binStep} bps` : "x·y=k"} />
        </dl>
      </Reveal>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10">
        <div className="min-w-0 space-y-10">
          {pool.type === "DLMM" ? (
            <Reveal>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="wide text-[13.5px]">Liquidity by bin</h2>
                <p className="font-mono text-[12px] text-faint">lime-topped bins: your range preview</p>
              </div>
              <div className="mt-4 panel ticks p-4 sm:p-6">
                <BinChart bins={bins} lo={lo} hi={hi} shape={shape} base={pool.base} quote={pool.quote} height={260} />
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <RangeInput label="Min price" value={lo} min={-34} max={hi} onChange={setLo} price={lowPrice} quote={pool.quote} />
                  <RangeInput label="Max price" value={hi} min={lo} max={34} onChange={setHi} price={highPrice} quote={pool.quote} />
                </div>
              </div>
            </Reveal>
          ) : (
            <Reveal>
              <h2 className="wide text-[13.5px]">Price</h2>
              <div className="mt-4 panel ticks p-4 sm:p-6">
                <AreaChart data={hist} label={`${pool.base}/${pool.quote} price`} format={(v) => `${fmtPrice(v)} ${pool.quote}`} formatT={(t) => (Number(t) === 95 ? "now" : `${95 - Number(t)}h ago`)} height={260} />
              </div>
            </Reveal>
          )}
          <Reveal>
            <h2 className="wide text-[13.5px]">About this pool</h2>
            <p className="mt-3 max-w-2xl text-[15px] text-muted">
              {pool.type === "DLMM"
                ? `Liquidity sits in ${pool.binStep}-bps bins. You only earn fees while the active bin is inside your range, so narrower ranges earn more per dollar and go out of range sooner.`
                : `Full-range constant-product pool. The fee starts at ${(pool.feeBps / 100).toFixed(2)}% and widens during volatile periods to protect liquidity providers.`}
            </p>
            <p className="mt-3 font-mono text-[12px] text-faint">Pool contract: not deployed · address published only after verification</p>
          </Reveal>
        </div>

        <div className="min-w-0">
          <div className="panel ticks lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="wide text-[13.5px]">Add liquidity</h2>
              <LaneBadge lane="public" />
            </div>
            <div className="space-y-4 p-5">
              {pool.type === "DLMM" && (
                <div>
                  <p className="mb-2 text-[13px] text-faint">Distribution</p>
                  <Segmented label="Distribution shape" value={shape} onChange={setShape} options={[{ value: "Spot", label: "Spot" }, { value: "Curve", label: "Curve" }, { value: "Bid-Ask", label: "Bid-Ask" }]} />
                </div>
              )}
              <AmountIn symbol={pool.base} value={a} onChange={onA} disabled={!needsBase} balance={address ? balances[pool.base] : undefined} invalid={overA} note={!needsBase ? `Range is below price: only ${pool.quote} is deposited.` : undefined} />
              <AmountIn symbol={pool.quote} value={b} onChange={onB} disabled={!needsQuote} balance={address ? balances[pool.quote] : undefined} invalid={overB} note={!needsQuote ? `Range is above price: only ${pool.base} is deposited.` : undefined} />
              <dl className="space-y-2 border-t border-line pt-4 text-[14px]">
                <div className="flex justify-between"><dt className="text-faint">Deposit value</dt><dd className="num">{fmtUsd(total)}</dd></div>
                {pool.type === "DLMM" && <div className="flex justify-between"><dt className="text-faint">Bins</dt><dd className="num">{hi - lo + 1}</dd></div>}
                <div className="flex justify-between"><dt className="text-faint">Est. fees per day</dt><dd className="num text-lime">{fmtUsd((total * pool.apr) / 100 / 365 * (pool.type === "DLMM" ? Math.min(3, 20 / (hi - lo + 1)) : 1))}</dd></div>
              </dl>
              <Button size="lg" className="w-full" disabled={disabled} onClick={() => (!address ? connect() : submit())}>{cta}</Button>
              <p className="text-center text-[12px] text-faint">Your position, amounts and range are public onchain.</p>
            </div>
          </div>
        </div>
      </div>

      <Modal open={tx !== null} onClose={() => { setTx(null); setA(""); setB(""); }} title={tx === 3 ? "Position opened" : "Adding liquidity"} dismissible={tx === 3}>
        <TxSteps steps={[
          { label: `Approve ${pool.base} and ${pool.quote}`, detail: "Exact amounts only, no unlimited allowance", state: st(0) },
          { label: "Sign deposit", detail: pool.type === "DLMM" ? `${hi - lo + 1} bins, ${shape} shape` : "Full range", state: st(1) },
          { label: "Confirmed", detail: tx === 3 ? "Simulated block, nothing was sent onchain" : undefined, state: tx === 3 ? "done" : st(2) },
        ]} />
        {tx === 3 && (
          <div className="mt-6 flex gap-3">
            <Link href="/positions" className="inline-flex h-11 flex-1 items-center justify-center rounded-sm bg-lime text-sm font-semibold wide text-lime-ink">View positions</Link>
            <Button variant="secondary" className="flex-1" onClick={() => { setTx(null); setA(""); setB(""); }}>Close</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RangeInput({ label, value, min, max, onChange, price, quote }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; price?: number; quote: string }) {
  const id = label.replace(/\s/g, "");
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] text-faint">{label}</label>
        <span className="num text-[14px]">{price ? fmtPrice(price) : "—"} <span className="text-faint">{quote}</span></span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-2 w-full accent-[#dfe3ee]" aria-valuetext={`${price ? fmtPrice(price) : ""} ${quote}, bin ${value}`} />
      <p className="num mt-1 text-[12px] text-faint">bin {value > 0 ? "+" : ""}{value}</p>
    </div>
  );
}

function AmountIn({ symbol, value, onChange, balance, disabled, invalid, note }: { symbol: string; value: string; onChange: (v: string) => void; balance?: number; disabled?: boolean; invalid?: boolean; note?: string }) {
  const id = `amt-${symbol}`;
  return (
    <div className={cx("rounded-md border bg-bg px-4 py-3 transition-colors focus-within:border-lime/60", invalid ? "border-danger/60" : "border-transparent", disabled && "opacity-55")}>
      <div className="flex items-center justify-between text-[13px]">
        <label htmlFor={id} className="text-faint">{symbol} amount</label>
        {balance !== undefined && (
          <button type="button" disabled={disabled} onClick={() => onChange(String(balance))} className="num text-faint hover:text-lime cursor-pointer disabled:cursor-not-allowed">Balance {fmtAmount(balance)}</button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} inputMode="decimal" placeholder="0" autoComplete="off" aria-invalid={invalid || undefined}
          className="num w-full min-w-0 flex-1 bg-transparent text-[24px] focus-visible:outline-none outline-none placeholder:text-line-strong disabled:cursor-not-allowed" />
        <span className="inline-flex items-center gap-2 font-semibold"><TokenMark symbol={symbol} size={24} />{symbol}</span>
      </div>
      {note && <p className="mt-1 text-[12px] text-faint">{note}</p>}
      {invalid && <p className="mt-1 text-[12px] text-danger">Amount exceeds your {symbol} balance.</p>}
    </div>
  );
}
