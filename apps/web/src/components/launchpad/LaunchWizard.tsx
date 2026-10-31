"use client";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAddress, type Address } from "viem";
import type { DbcAddresses } from "@zkblast/sdk";
import { Modal } from "@/components/ui/Modal";
import {
  executeDbcTransactions,
  contractCallTransaction,
  dbcClient,
  bytes32Salt,
} from "@/lib/dbc-transactions";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { formatTokenAmount } from "@zkblast/sdk";
import type { DbcTemplate, TemplateEconomics } from "./types";

export function LaunchWizard({
  open,
  onClose,
  templates,
  deployment,
  onComplete,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  templates: readonly DbcTemplate[];
  deployment: DbcAddresses;
  onComplete: () => void;
}>) {
  const { address, config, connect, toast } = useApp();
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.enabled)?.template_id ?? "",
  );
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("");
  const [economics, setEconomics] = useState<TemplateEconomics | null>(null);
  const [economicsLoading, setEconomicsLoading] = useState(false);
  const selected = useMemo(
    () => templates.find((item) => item.template_id === templateId),
    [templates, templateId],
  );
  const walletRecipient = recipient || address || "";
  useEffect(() => {
    if (!templateId) {
      setEconomics(null);
      return;
    }
    const controller = new AbortController();
    setEconomicsLoading(true);
    void apiRequest<TemplateEconomics>(
      webPublicConfig.apiUrl,
      `/v1/dbc/templates/${templateId}/economics`,
      { signal: controller.signal },
    )
      .then(setEconomics)
      .catch(() => setEconomics(null))
      .finally(() => {
        if (!controller.signal.aborted) setEconomicsLoading(false);
      });
    return () => controller.abort();
  }, [templateId]);
  const validMetadata =
    /^ipfs:\/\/.+/u.test(metadataUri) || /^https:\/\/.+/u.test(metadataUri);
  const canContinue =
    step === 0
      ? Boolean(selected)
      : step === 1
        ? name.trim().length > 0 &&
          symbol.trim().length > 0 &&
          symbol.length <= 12 &&
          validMetadata &&
          /^0x[\da-f]{40}$/iu.test(walletRecipient)
        : true;
  async function submit() {
    if (!address) return connect();
    if (!window.ethereum || !config || !selected) return;
    setStatus("preparing");
    try {
      const call = dbcClient(deployment).createLaunch({
        templateId: BigInt(selected.template_id),
        salt: bytes32Salt(),
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        metadataUri,
        creatorTokenRecipient: getAddress(walletRecipient) as Address,
      });
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [contractCallTransaction(call)],
        action: "Token launch",
        onStatus: setStatus,
      });
      toast({
        kind: "success",
        title: "Launch created",
        body: "The indexer will publish the new curve market after finality.",
      });
      onComplete();
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "LAUNCH_FAILED");
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a curve launch"
      width="max-w-2xl"
    >
      <div className="mb-5 grid grid-cols-3 gap-2">
        {["Template", "Token", "Review"].map((label, index) => (
          <div
            key={label}
            className={`border px-3 py-2 font-mono text-[10px] uppercase ${index === step ? "border-lime text-fg" : "border-line text-muted"}`}
          >
            {index + 1}. {label}
          </div>
        ))}
      </div>
      {step === 0 && (
        <div className="space-y-3">
          <div>
            <p className="label">Governed template</p>
            <p className="mt-2 text-sm text-muted">
              Templates lock supply, curve, fees, quote asset and DAMM migration
              policy before launch.
            </p>
          </div>
          {templates
            .filter((t) => t.enabled)
            .map((item) => (
              <button
                key={item.template_id}
                onClick={() => setTemplateId(item.template_id)}
                className={`w-full border p-4 text-left ${templateId === item.template_id ? "border-lime bg-white/[.03]" : "border-line"}`}
              >
                <span className="font-mono text-sm">
                  Template {item.template_id} · v{item.version}
                </span>
                <span className="mt-2 block break-all text-[10px] text-muted">
                  Config {item.config_hash}
                </span>
              </button>
            ))}
          {economicsLoading ? (
            <p className="text-xs text-muted">Loading onchain economics…</p>
          ) : (
            economics && (
              <div className="panel-inset grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
                <Review
                  label="Supply"
                  value={formatTokenAmount(
                    BigInt(economics.totalSupplyRaw),
                    18,
                  )}
                />
                <Review
                  label="Curve inventory"
                  value={formatTokenAmount(
                    BigInt(economics.baseInventoryRaw),
                    18,
                  )}
                />
                <Review
                  label="Threshold"
                  value={`${formatTokenAmount(BigInt(economics.graduationThresholdRaw), 6)} USDG`}
                />
                <Review
                  label="Trade fee"
                  value={`${economics.tradeFeeBps / 100}%`}
                />
                <Review
                  label="DAMM fee"
                  value={`${economics.destinationFeePips / 10_000}%`}
                />
                <Review
                  label="Creator LP"
                  value={`${economics.creatorLpShareBps / 100}%`}
                />
              </div>
            )
          )}
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Token name"
            value={name}
            onChange={setName}
            placeholder="ZKBLAST Launch"
          />
          <Field
            label="Symbol"
            value={symbol}
            onChange={setSymbol}
            placeholder="TOKEN"
          />
          <div className="sm:col-span-2">
            <Field
              label="Metadata URI"
              value={metadataUri}
              onChange={setMetadataUri}
              placeholder="ipfs://…"
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Creator token recipient"
              value={walletRecipient}
              onChange={setRecipient}
              placeholder="0x…"
            />
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div className="panel-inset grid gap-px bg-line sm:grid-cols-2">
            <Review label="Token" value={`${name} / ${symbol.toUpperCase()}`} />
            <Review
              label="Template"
              value={`#${templateId} · v${selected?.version ?? "—"}`}
            />
            <Review
              label="Supply / inventory"
              value={
                economics
                  ? `${formatTokenAmount(BigInt(economics.totalSupplyRaw), 18)} / ${formatTokenAmount(BigInt(economics.baseInventoryRaw), 18)}`
                  : "Unavailable"
              }
            />
            <Review
              label="Fees"
              value={
                economics
                  ? `Trade ${economics.tradeFeeBps / 100}% · DAMM ${economics.destinationFeePips / 10_000}%`
                  : "Unavailable"
              }
            />
            <Review
              label="Graduation"
              value={
                economics
                  ? `${formatTokenAmount(BigInt(economics.graduationThresholdRaw), 6)} USDG · ±${economics.terminalPriceToleranceBps / 100}%`
                  : "Unavailable"
              }
            />
            <Review
              label="LP policy"
              value={
                economics
                  ? `Creator ${economics.creatorLpShareBps / 100}% · lock ${Math.ceil(economics.creatorLockSeconds / 86400)}d`
                  : "Unavailable"
              }
            />
            <Review label="Recipient" value={walletRecipient} />
            <Review label="Metadata" value={metadataUri} />
          </div>
          <p className="text-xs leading-5 text-muted">
            Your wallet creates the token and virtual pool atomically. Review
            the wallet simulation before signing.
          </p>
          <button
            disabled={!economics || (Boolean(status) && status !== "confirmed")}
            onClick={() => void submit()}
            className="flex w-full items-center justify-center gap-2 bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-50"
          >
            <Rocket className="size-4" />
            {status || "Create launch"}
          </button>
        </div>
      )}
      <div className="mt-6 flex justify-between border-t border-line pt-4">
        <button
          disabled={step === 0}
          onClick={() => setStep((v) => v - 1)}
          className="flex items-center gap-2 border border-line px-4 py-2 text-xs disabled:opacity-30"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        {step < 2 && (
          <button
            disabled={!canContinue}
            onClick={() => setStep((v) => v + 1)}
            className="flex items-center gap-2 bg-lime px-4 py-2 text-xs text-lime-ink disabled:opacity-30"
          >
            Continue <ArrowRight className="size-4" />
          </button>
        )}
        {step === 2 && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <Check className="size-4" />
            Ready for wallet
          </span>
        )}
      </div>
    </Modal>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full border border-line bg-bg px-3 text-sm outline-none focus:border-lime/70"
      />
    </label>
  );
}
function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-bg p-4">
      <p className="label">{label}</p>
      <p className="mt-2 break-all text-sm">{value}</p>
    </div>
  );
}
