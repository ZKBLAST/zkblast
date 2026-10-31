"use client";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
} from "viem";
import {
  formatTokenAmount,
  minimumAmountOut,
  parseTokenAmount,
  type DbcAddresses,
} from "@zkblast/sdk";
import { launchFactoryAbi } from "@zkblast/abi";
import { Modal } from "@/components/ui/Modal";
import {
  executeDbcTransactions,
  contractCallTransaction,
  dbcClient,
  bytes32Salt,
  approvalTransaction,
  type DbcQuoteResponse,
} from "@/lib/dbc-transactions";
import { useApp } from "@/components/shell/AppProvider";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import type { DbcTemplate, TemplateEconomics } from "./types";
import { prepareLaunchLogo } from "@/lib/launch-metadata";

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
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [logo, setLogo] = useState<{
    mime: "image/webp";
    base64: string;
    previewUrl: string;
  } | null>(null);
  const [logoStatus, setLogoStatus] = useState("");
  const [recipient, setRecipient] = useState("");
  const [initialBuy, setInitialBuy] = useState("");
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
  const validWebsite = !websiteUrl || /^https:\/\/.+/u.test(websiteUrl);
  const validX =
    !xUrl || /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/.+/iu.test(xUrl);
  const initialBuyRaw = useMemo(() => {
    try {
      return initialBuy ? parseTokenAmount(initialBuy, 6) : 0n;
    } catch {
      return -1n;
    }
  }, [initialBuy]);
  const validInitialBuy =
    initialBuyRaw >= 0n &&
    (!economics || initialBuyRaw <= BigInt(economics.graduationThresholdRaw));
  const canContinue =
    step === 0
      ? Boolean(selected)
      : step === 1
        ? name.trim().length > 0 &&
          symbol.trim().length > 0 &&
          symbol.length <= 12 &&
          validWebsite &&
          validX &&
          validInitialBuy &&
          /^0x[\da-f]{40}$/iu.test(walletRecipient)
        : true;
  async function submit() {
    if (!address) return connect();
    if (!window.ethereum || !config || !selected) return;
    setStatus("preparing");
    let launchCreated = false;
    try {
      const metadata = await apiRequest<{ metadataUri: string }>(
        webPublicConfig.apiUrl,
        "/v1/dbc/metadata",
        {
          method: "POST",
          body: JSON.stringify({
            websiteUrl,
            xUrl,
            logoMime: logo?.mime ?? null,
            logoBase64: logo?.base64 ?? null,
          }),
        },
      );
      const client = dbcClient(deployment);
      const salt = bytes32Salt();
      const call = client.createLaunch({
        templateId: BigInt(selected.template_id),
        salt,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        metadataUri: metadata.metadataUri,
        creatorTokenRecipient: getAddress(walletRecipient),
      });
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [contractCallTransaction(call)],
        action: "Token launch",
        onStatus: setStatus,
      });
      launchCreated = true;
      if (initialBuyRaw > 0n && economics) {
        const launchId = keccak256(
          encodeAbiParameters(
            [
              { type: "uint256" },
              { type: "address" },
              { type: "address" },
              { type: "uint256" },
              { type: "bytes32" },
            ],
            [
              BigInt(config.chainId),
              getAddress(deployment.launchFactory),
              getAddress(address),
              BigInt(selected.template_id),
              salt,
            ],
          ),
        );
        setStatus("preparing initial buy");
        const launchCall = client.launch(launchId);
        const rawLaunch = (await window.ethereum.request({
          method: "eth_call",
          params: [
            {
              to: deployment.launchFactory,
              data: encodeFunctionData(
                launchCall as Parameters<typeof encodeFunctionData>[0],
              ),
            },
            "latest",
          ],
        })) as `0x${string}`;
        const record = decodeFunctionResult({
          abi: launchFactoryAbi,
          functionName: "launches",
          data: rawLaunch,
        });
        const pool = getAddress(record[2]);
        const quote = await apiRequest<DbcQuoteResponse>(
          webPublicConfig.apiUrl,
          "/v1/dbc/quote",
          {
            method: "POST",
            body: JSON.stringify({
              pool,
              side: "buy",
              amountRaw: initialBuyRaw.toString(),
            }),
          },
        );
        if (!quote.baseOutRaw) throw new Error("INITIAL_BUY_QUOTE_INVALID");
        const deadline = BigInt(Math.floor(Date.now() / 1_000) + 900);
        await executeDbcTransactions({
          provider: window.ethereum,
          account: address,
          chainId: config.chainId,
          calls: [
            approvalTransaction(
              getAddress(economics.quoteToken),
              pool,
              initialBuyRaw,
            ),
            contractCallTransaction(
              client.buyExactInput({
                pool,
                grossQuoteInRaw: initialBuyRaw,
                minimumBaseOutRaw: minimumAmountOut(
                  BigInt(quote.baseOutRaw),
                  100,
                ),
                maximumPriceX18:
                  (BigInt(quote.finalPriceX18) * 10_100n) / 10_000n,
                recipient: getAddress(walletRecipient),
                deadline,
              }),
            ),
          ],
          action: "Initial curve buy",
          onStatus: setStatus,
        });
      }
      toast({
        kind: "success",
        title: "Launch created",
        body:
          initialBuyRaw > 0n
            ? "Launch and initial buy confirmed. Market data will appear after finality."
            : "The indexer will publish the new curve market after finality.",
      });
      onComplete();
      window.setTimeout(onComplete, 4_000);
      window.setTimeout(onComplete, 10_000);
      onClose();
    } catch (error) {
      if (launchCreated) {
        const reason =
          error instanceof Error ? error.message : "INITIAL_BUY_FAILED";
        toast({
          kind: "success",
          title: "Launch created",
          body: `Initial buy was not completed (${reason}). You can buy from the launch market after indexing.`,
        });
        onComplete();
        window.setTimeout(onComplete, 4_000);
        onClose();
        return;
      }
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
            <span className="label">Token logo</span>
            <label className="mt-2 flex min-h-24 cursor-pointer items-center gap-4 border border-dashed border-line bg-bg p-3 hover:border-lime/60">
              {logo ? (
                <img
                  src={logo.previewUrl}
                  alt="Token logo preview"
                  className="size-16 rounded-full bg-white object-cover"
                />
              ) : (
                <span className="grid size-16 place-items-center rounded-full border border-line">
                  <ImagePlus className="size-5 text-muted" />
                </span>
              )}
              <span className="min-w-0 text-xs text-muted">
                <span className="block text-fg">
                  {logo ? "Replace logo" : "Upload logo"}
                </span>
                <span className="mt-1 block">
                  PNG, JPG or WebP · automatically optimized
                </span>
                {logoStatus && (
                  <span className="mt-1 block text-danger">{logoStatus}</span>
                )}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setLogoStatus("Optimizing…");
                  void prepareLaunchLogo(file)
                    .then((next) => {
                      if (logo) URL.revokeObjectURL(logo.previewUrl);
                      setLogo(next);
                      setLogoStatus("");
                    })
                    .catch((error) =>
                      setLogoStatus(
                        error instanceof Error ? error.message : "LOGO_FAILED",
                      ),
                    );
                }}
              />
            </label>
          </div>
          <Field
            label="Website"
            value={websiteUrl}
            onChange={setWebsiteUrl}
            placeholder="https://project.example"
          />
          <Field
            label="X profile"
            value={xUrl}
            onChange={setXUrl}
            placeholder="https://x.com/project"
          />
          <div className="sm:col-span-2">
            {!validWebsite || !validX ? (
              <p className="text-xs text-danger">
                Use a valid HTTPS website and X profile URL.
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Creator token recipient"
              value={walletRecipient}
              onChange={setRecipient}
              placeholder="0x…"
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Initial buy · optional (USDG)"
              value={initialBuy}
              onChange={setInitialBuy}
              placeholder="0.01"
            />
            <p className="mt-2 text-[11px] leading-5 text-muted">
              After launch creation, your wallet approves USDG and performs the
              first curve buy. Leave empty to create without buying.
            </p>
            {!validInitialBuy && (
              <p className="mt-1 text-xs text-danger">
                Enter a valid USDG amount within the graduation threshold.
              </p>
            )}
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
            <Review label="Website" value={websiteUrl || "Not provided"} />
            <Review label="X profile" value={xUrl || "Not provided"} />
            <Review label="Logo" value={logo ? "Ready" : "Not provided"} />
            <Review
              label="Initial buy"
              value={initialBuyRaw > 0n ? `${initialBuy} USDG` : "None"}
            />
          </div>
          <p className="text-xs leading-5 text-muted">
            Your wallet creates the token and virtual pool atomically. If an
            initial buy is set, approval and buy follow as separate wallet
            confirmations so every onchain action remains visible.
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
