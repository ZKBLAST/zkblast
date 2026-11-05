import { Check, CirclePause, Radio, ShieldCheck } from "lucide-react";

import type {
  StockQuoteAssetView,
  StockQuoteDestinationView,
} from "./types";

const sentenceCase = (value: string) =>
  value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());

function PolicyState({ enabled }: Readonly<{ enabled: boolean }>) {
  return (
    <span className={enabled ? "text-lime" : "text-muted"}>
      {enabled ? "Enabled" : "Disabled by policy"}
    </span>
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
  const selectedDestination = destinations.find(
    (item) => item.migrationMode === selectedMigrationMode,
  );
  const executable =
    asset.quoteTradingEnabled &&
    asset.graduationEnabled &&
    selectedDestination?.enabled === true;

  return (
    <section className="panel-inset space-y-4 p-4" aria-label="Tokenized stock quote policy">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Tokenized stock quote asset</p>
          <p className="mt-2 text-sm text-fg">
            {asset.instrumentName} · {asset.symbol}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Issuer {asset.issuerName} · {sentenceCase(asset.marketState)} session
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
        This quote asset represents an issuer-provided tokenized instrument. It is
        identified by its chain and contract address, not by its ticker or logo.
      </p>

      <div className="grid grid-cols-2 gap-px bg-line text-[11px] sm:grid-cols-4">
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Multiplier</span>
          <span className="mt-1 block break-all text-fg">{asset.currentMultiplier}</span>
        </div>
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Trading</span>
          <span className="mt-1 block"><PolicyState enabled={asset.quoteTradingEnabled} /></span>
        </div>
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Graduation</span>
          <span className="mt-1 block"><PolicyState enabled={asset.graduationEnabled} /></span>
        </div>
        <div className="bg-bg p-3">
          <span className="font-mono uppercase text-muted">Oracle</span>
          <span className="mt-1 block text-fg">
            {asset.priceFeedAddress ? `${asset.maxOracleAgeSeconds ?? "—"}s heartbeat` : "Not configured"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["damm", "dlmm"] as const).map((mode) => {
          const destination = destinations.find((item) => item.migrationMode === mode);
          const active = destination?.enabled === true;
          return (
            <div
              key={mode}
              className={`border p-3 text-[11px] ${
                mode === selectedMigrationMode ? "border-lime/70" : "border-line"
              }`}
            >
              <span className="flex items-center gap-2 font-mono uppercase text-muted">
                {active ? <Check className="size-3 text-lime" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
                {mode}
              </span>
              <span className="mt-2 block text-fg">
                {active ? "Verified destination" : "No active capability receipt"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-1 font-mono text-[10px] text-muted">
        <p className="break-all">Contract {asset.contractAddress}</p>
        <p className="break-all">Issuer asset {asset.issuerAssetId}</p>
      </div>

      {!executable && (
        <p className="border border-line bg-white/[.02] p-3 text-[11px] leading-5 text-muted">
          Creation with this quote asset is disabled until governance activates
          trading, graduation, oracle policy, and the {selectedMigrationMode.toUpperCase()} capability receipt.
        </p>
      )}
    </section>
  );
}
