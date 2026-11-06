import { useState, type FormEvent } from "react";
import {
  Check,
  CirclePause,
  LoaderCircle,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { formatUnits, parseUnits } from "viem";

import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import type {
  StockQuoteAssetView,
  StockQuoteDestinationView,
  StockQuotePreviewView,
} from "./types";

const sentenceCase = (value: string) =>
  value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
const previewReason = (reason: string) =>
  ({
    ASSET_NOT_LISTED: "Asset is not listed for execution",
    QUOTE_TRADING_DISABLED: "Quote trading is disabled by policy",
    GRADUATION_DISABLED: "Graduation is disabled by policy",
    MARKET_SESSION_RESTRICTED:
      "The current market session restricts this operation",
    DESTINATION_DISABLED: "The selected liquidity destination is not enabled",
    ORACLE_NOT_CONFIGURED: "A validated oracle policy is not configured",
    VALIDATED_ORACLE_PRICE_UNAVAILABLE:
      "A current validated oracle price is unavailable",
  })[reason] ?? sentenceCase(reason);

function PolicyState({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <span className={enabled ? "text-lime" : "text-muted"}>
      {enabled ? "Enabled" : "Disabled by policy"}
    </span>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="bg-bg p-3">
      <span className="font-mono uppercase text-muted">{label}</span>
      <span className="mt-1 block break-all text-fg">{value}</span>
    </div>
  );
}

export function StockQuoteAssetSummary({
  asset,
  destinations,
  selectedMigrationMode,
}: Readonly<{
  asset: StockQuoteAssetView;
  destinations: readonly StockQuoteDestinationView[];
  selectedMigrationMode: "damm" | "dlmm";
}>) {
  const [amount, setAmount] = useState("1");
  const [preview, setPreview] = useState<StockQuotePreviewView | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const selectedDestination = destinations.find(
    (item) => item.migrationMode === selectedMigrationMode,
  );
  const launchExecutable = asset.quoteTradingEnabled;
  const graduationExecutable =
    asset.graduationEnabled && selectedDestination?.enabled === true;

  async function loadPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewError("");
    setPreviewing(true);
    try {
      const amountRaw = parseUnits(amount || "0", asset.tokenDecimals);
      setPreview(
        await apiRequest<StockQuotePreviewView>(
          webPublicConfig.apiUrl,
          "/v1/stock-quotes/preview",
          {
            method: "POST",
            body: JSON.stringify({
              contractAddress: asset.contractAddress,
              amountRaw: amountRaw.toString(),
              operation: "create_launch",
              migrationMode: selectedMigrationMode,
            }),
          },
        ),
      );
    } catch (error) {
      setPreview(null);
      setPreviewError(
        error instanceof Error ? error.message : "PREVIEW_UNAVAILABLE",
      );
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section
      className="panel-inset space-y-4 p-4"
      aria-label="Tokenized stock quote policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Tokenized stock quote asset</p>
          <p className="mt-2 text-sm text-fg">
            {asset.instrumentName} · {asset.symbol}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Issuer {asset.issuerName} · {sentenceCase(asset.marketState)}{" "}
            session
          </p>
        </div>
        <span className="flex items-center gap-2 border border-line px-2 py-1 font-mono text-[10px] uppercase">
          {asset.marketState === "active" ? (
            <Radio className="size-3 text-lime" aria-hidden />
          ) : (
            <CirclePause className="size-3 text-muted" aria-hidden />
          )}
          {sentenceCase(asset.availability)}
        </span>
      </div>
      <p className="text-[11px] leading-5 text-muted">
        This quote asset represents an issuer-provided tokenized instrument. It
        is identified by its chain and contract address, not by its ticker or
        logo.
      </p>

      <div className="grid grid-cols-2 gap-px bg-line text-[11px] sm:grid-cols-4">
        <Metric label="Multiplier" value={asset.currentMultiplier} />
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Trading</span>
          <span className="mt-1 block">
            <PolicyState enabled={asset.quoteTradingEnabled} />
          </span>
        </div>
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Graduation</span>
          <span className="mt-1 block">
            <PolicyState enabled={asset.graduationEnabled} />
          </span>
        </div>
        <Metric
          label="Oracle"
          value={
            asset.priceFeedAddress
              ? `${asset.maxOracleAgeSeconds ?? "—"}s heartbeat`
              : "Not configured"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["damm", "dlmm"] as const).map((mode) => {
          const active =
            destinations.find((item) => item.migrationMode === mode)
              ?.enabled === true;
          return (
            <div
              key={mode}
              className={`border p-3 text-[11px] ${mode === selectedMigrationMode ? "border-lime/70" : "border-line"}`}
            >
              <span className="flex items-center gap-2 font-mono uppercase text-muted">
                {active ? (
                  <Check className="size-3 text-lime" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3" aria-hidden />
                )}
                {mode}
              </span>
              <span className="mt-2 block text-fg">
                {active
                  ? "Verified destination"
                  : "No active capability receipt"}
              </span>
            </div>
          );
        })}
      </div>

      <form
        className="space-y-3 border-t border-line pt-4"
        onSubmit={(event) => {
          void loadPreview(event);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="font-mono text-[10px] uppercase text-muted">
              Native {asset.symbol} amount
            </span>
            <span className="mt-2 flex h-11 items-center border border-line bg-bg px-3 focus-within:border-lime/60">
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setPreview(null);
                  setPreviewError("");
                }}
                aria-label={`Native ${asset.symbol} amount`}
              />
              <span className="font-mono text-[10px] text-muted">
                {asset.symbol}
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={previewing || !amount.trim()}
            className="flex h-11 items-center justify-center gap-2 bg-lime px-5 font-mono text-[10px] uppercase text-lime-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing && (
              <LoaderCircle className="size-3 animate-spin" aria-hidden />
            )}
            Preview policy
          </button>
        </div>
        {preview && (
          <div className="grid gap-px bg-line text-[11px] sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Native quantity"
              value={`${preview.amount} ${preview.symbol}`}
            />
            <Metric
              label="Adjusted quantity"
              value={`${formatUnits((BigInt(preview.amountRaw) * BigInt(preview.multiplierX18)) / 10n ** 18n, preview.tokenDecimals)} ${preview.symbol}`}
            />
            <Metric
              label="Validated USD notional"
              value={
                preview.usdNotionalX18
                  ? `$${formatUnits(BigInt(preview.usdNotionalX18), 18)}`
                  : "Unavailable"
              }
            />
            <Metric
              label="Oracle observation"
              value={
                preview.oracleUpdatedAt
                  ? `${new Date(Number(preview.oracleUpdatedAt) * 1_000).toLocaleString()} · round ${preview.oracleRoundId ?? "—"}`
                  : "Unavailable"
              }
            />
          </div>
        )}
        {preview && preview.reasons.length > 0 && (
          <ul className="space-y-1 border border-line bg-white/[.02] p-3 text-[11px] text-muted">
            {preview.reasons.map((reason) => (
              <li key={reason}>— {previewReason(reason)}</li>
            ))}
          </ul>
        )}
        {previewError && (
          <p className="text-[11px] text-danger">
            Preview unavailable · {previewError}
          </p>
        )}
      </form>

      <div className="space-y-1 font-mono text-[10px] text-muted">
        <p className="break-all">Contract {asset.contractAddress}</p>
        <p className="break-all">Issuer asset {asset.issuerAssetId}</p>
      </div>
      {!launchExecutable && (
        <p className="border border-line bg-white/[.02] p-3 text-[11px] leading-5 text-muted">
          Creation with this quote asset is disabled until governance activates
          its trading and oracle policy.
        </p>
      )}
      {launchExecutable && !graduationExecutable && (
        <p className="border border-line bg-white/[.02] p-3 text-[11px] leading-5 text-muted">
          Launch creation and curve trading are enabled. Graduation remains
          disabled until the {selectedMigrationMode.toUpperCase()} destination
          receives its separate capability receipt.
        </p>
      )}
    </section>
  );
}
