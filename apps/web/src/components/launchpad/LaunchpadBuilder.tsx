"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, formatEther, formatUnits, getAddress } from "viem";
import { launchpadRegistryAbi } from "@zkblast/abi";
import {
  LaunchpadClient,
  linearCurvePreview,
  type LaunchpadAddresses,
} from "@zkblast/sdk";
import { useApp } from "@/components/shell/AppProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { contractCallTransaction } from "@/lib/dbc-transactions";
import { executeTransactions, type PreparedTransaction } from "@/lib/swap-flow";
import {
  launchpadMetadataCommitment,
  prepareLaunchpadImage,
  launchpadSlugCommitment,
  type PreparedLaunchpadImage,
} from "@/lib/launchpad-builder-crypto";
import type { PendingLaunchpad } from "./LaunchpadOwnerDashboard";
import type { TemplateEconomics } from "./types";
import { launchpadWalletError } from "@/lib/launchpad-wallet-errors";
import { fmtPrice } from "@/lib/format";

type LaunchpadConfiguration = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  abiVersion: 1;
  registry: string;
  configManager: string;
  factory: string;
  lens: string;
  feeController: string;
  revenueSplitter: string;
  feeCollector: string;
  tokenFactory: string;
}>;
type LaunchpadPreset = Readonly<{
  presetId: string;
  familyId: string;
  configHash: string;
  dbcTemplateId: string;
  quoteToken: string;
  maximumTotalTradeFeeBps: number;
  graduationDestination: number;
  creatorAccess: number;
  maximumLaunches: number;
  version: number;
  used: boolean;
}>;
type GraduationCapabilities = Readonly<{
  dammGraduation: boolean;
  dlmmGraduation: boolean;
}>;

const steps = ["Identity", "Ownership", "Economics", "Preview"] as const;

const builderError = launchpadWalletError;

export function LaunchpadBuilder({
  onOpenMarkets,
  onOpenManage,
  onCreated,
}: Readonly<{
  onOpenMarkets: () => void;
  onOpenManage: () => void;
  onCreated: (item: PendingLaunchpad) => void;
}>) {
  const { address, config, connect, toast } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [treasury, setTreasury] = useState("");
  const [operatorRecipient, setOperatorRecipient] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [hostname, setHostname] = useState("");
  const [primary, setPrimary] = useState("#dfe3ee");
  const [logo, setLogo] = useState<PreparedLaunchpadImage | null>(null);
  const [favicon, setFavicon] = useState<PreparedLaunchpadImage | null>(null);
  const [imageStatus, setImageStatus] = useState("");
  const [configuration, setConfiguration] =
    useState<LaunchpadConfiguration | null>(null);
  const [presets, setPresets] = useState<readonly LaunchpadPreset[]>([]);
  const [graduationCapabilities, setGraduationCapabilities] =
    useState<GraduationCapabilities>({
      dammGraduation: false,
      dlmmGraduation: false,
    });
  const [presetId, setPresetId] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [templateEconomics, setTemplateEconomics] =
    useState<TemplateEconomics | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [deploymentBusy, setDeploymentBusy] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState("");
  const [createdLaunchpadId, setCreatedLaunchpadId] = useState("");
  const [createdTransactionHash, setCreatedTransactionHash] = useState("");
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingPublished, setBrandingPublished] = useState(false);
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainVerified, setDomainVerified] = useState(false);
  const [domainChallenge, setDomainChallenge] = useState<Readonly<{
    domainId: string;
    hostname: string;
    recordName: string;
    recordValue: string;
    expiresAt: string;
  }> | null>(null);
  const [feePolicyBusy, setFeePolicyBusy] = useState(false);
  const [feePolicyConfigured, setFeePolicyConfigured] = useState(false);
  const [totalTradeFeeBps, setTotalTradeFeeBps] = useState(30);
  const [protocolShareBps, setProtocolShareBps] = useState(2_000);
  const [operatorShareBps, setOperatorShareBps] = useState(3_000);
  const [creatorShareBps, setCreatorShareBps] = useState(5_000);
  const [referralShareBps, setReferralShareBps] = useState(0);
  const [prepared, setPrepared] = useState<Readonly<{
    transaction: PreparedTransaction;
    metadataHash: `0x${string}`;
    slugCommitment: `0x${string}`;
    gas: bigint;
    gasPrice: bigint;
  }> | null>(null);
  const owner = address ?? "Connect wallet to set owner";
  const effectiveTreasury = treasury || address || "Treasury required";
  const identityReady =
    name.trim().length >= 2 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) &&
    description.trim().length >= 10 &&
    (!website || /^https:\/\/.+/u.test(website)) &&
    (!xUrl ||
      /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/.+/iu.test(xUrl)) &&
    (!hostname ||
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/iu.test(
        hostname,
      ));
  const ownershipReady = Boolean(
    address && /^0x[\da-f]{40}$/iu.test(effectiveTreasury),
  );
  const selectedPreset =
    presets.find((preset) => preset.presetId === presetId) ?? null;
  const feeShareTotal =
    protocolShareBps + operatorShareBps + creatorShareBps + referralShareBps;
  const effectiveOperatorRecipient = operatorRecipient || effectiveTreasury;
  const feePolicyReady = Boolean(
    selectedPreset &&
    totalTradeFeeBps >= 0 &&
    totalTradeFeeBps <= selectedPreset.maximumTotalTradeFeeBps &&
    feeShareTotal === 10_000 &&
    /^0x[\da-f]{40}$/iu.test(effectiveOperatorRecipient),
  );
  const canContinue =
    step === 0
      ? identityReady
      : step === 1
        ? ownershipReady
        : step === 2
          ? feePolicyReady
          : true;
  const completion = useMemo(
    () => [identityReady, ownershipReady, feePolicyReady, false],
    [identityReady, ownershipReady, feePolicyReady],
  );
  const curvePreview = useMemo(() => {
    const segment = templateEconomics?.curveSegments[0];
    if (!segment) return [];
    try {
      return linearCurvePreview(
        {
          initialPriceX18: BigInt(segment.initialPriceX18),
          slopeX18: BigInt(segment.slopeX18),
          saleCapacityX18: BigInt(segment.saleCapacityX18),
        },
        20,
      );
    } catch {
      return [];
    }
  }, [templateEconomics]);
  const curvePath = useMemo(() => {
    if (curvePreview.length < 2) return "";
    const first = curvePreview.at(0);
    const last = curvePreview.at(-1);
    if (!first || !last) return "";
    const minimum = first.priceX18;
    const maximum = last.priceX18;
    const range = maximum > minimum ? maximum - minimum : 1n;
    return curvePreview
      .map((point, index) => {
        const x = 4 + (index * 92) / (curvePreview.length - 1);
        const normalized =
          Number(((point.priceX18 - minimum) * 10_000n) / range) / 100;
        const y = 90 - normalized * 0.8;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [curvePreview]);
  const curveFacts = useMemo(() => {
    const segment = templateEconomics?.curveSegments[0];
    const terminal = curvePreview.at(-1)?.priceX18;
    if (!segment || terminal === undefined || curvePreview.length < 2)
      return null;
    return {
      startPrice: fmtPrice(
        Number(formatEther(BigInt(segment.initialPriceX18))),
      ),
      terminalPrice: fmtPrice(Number(formatEther(terminal))),
      saleCapacity: Number(
        formatEther(BigInt(segment.saleCapacityX18)),
      ).toLocaleString("en-US", { maximumFractionDigits: 2 }),
      graduationReserve: Number(
        formatUnits(BigInt(templateEconomics.graduationThresholdRaw), 6),
      ).toLocaleString("en-US", { maximumFractionDigits: 6 }),
    };
  }, [curvePreview, templateEconomics]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError("");
    setConfiguration(null);
    setPresets([]);
    setPresetId("");
    setTemplateEconomics(null);
    void Promise.all([
      apiRequest<LaunchpadConfiguration>(
        webPublicConfig.apiUrl,
        "/v1/launchpads/configuration",
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<{
        globalFeeCapBps: number;
        capabilities: GraduationCapabilities;
        items: LaunchpadPreset[];
      }>(webPublicConfig.apiUrl, "/v1/launchpads/presets", {
        signal: controller.signal,
        cache: "no-store",
      }),
    ])
      .then(([configurationResult, presetResult]) => {
        setConfiguration(configurationResult);
        setPresets(presetResult.items);
        setGraduationCapabilities(presetResult.capabilities);
        setPresetId((current) =>
          presetResult.items.some((item) => item.presetId === current)
            ? current
            : (presetResult.items[0]?.presetId ?? ""),
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setCatalogError(
            builderError(
              reason,
              "Approved presets are temporarily unavailable. Retry shortly.",
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [config?.chainId]);
  useEffect(() => {
    if (!selectedPreset) {
      setTemplateEconomics(null);
      return;
    }
    const controller = new AbortController();
    void apiRequest<TemplateEconomics>(
      webPublicConfig.apiUrl,
      `/v1/dbc/templates/${selectedPreset.dbcTemplateId}/economics`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(setTemplateEconomics)
      .catch(() => {
        if (!controller.signal.aborted) setTemplateEconomics(null);
      });
    return () => controller.abort();
  }, [selectedPreset]);
  useEffect(() => {
    setPrepared(null);
    setDeploymentStatus("");
  }, [
    address,
    description,
    effectiveTreasury,
    name,
    logo,
    favicon,
    hostname,
    operatorRecipient,
    totalTradeFeeBps,
    protocolShareBps,
    operatorShareBps,
    creatorShareBps,
    referralShareBps,
    presetId,
    primary,
    slug,
    website,
    xUrl,
  ]);

  async function prepareDeployment() {
    if (!address) return connect();
    if (!window.ethereum || !configuration || !selectedPreset || !config)
      return;
    setPreflightBusy(true);
    setDeploymentStatus("Checking wallet network and estimating gas");
    try {
      const currentChain = Number.parseInt(
        (await window.ethereum.request({ method: "eth_chainId" })) as string,
        16,
      );
      if (currentChain !== configuration.chainId)
        throw new Error(
          `Switch wallet to chain ${configuration.chainId} before preflight`,
        );
      const metadataHash = await launchpadMetadataCommitment({
        slug,
        name: name.trim(),
        description: description.trim(),
        primaryColor: primary.toLowerCase(),
        backgroundColor: "#090910",
        foregroundColor: "#f5f5f7",
        websiteUrl: website || null,
        xUrl: xUrl || null,
        logoSha256: logo?.sha256,
        faviconSha256: favicon?.sha256,
      });
      const slugCommitment = launchpadSlugCommitment(slug);
      const client = new LaunchpadClient(configuration as LaunchpadAddresses);
      const transaction = contractCallTransaction(
        client.createLaunchpad({
          owner: getAddress(address),
          treasury: getAddress(effectiveTreasury),
          metadataHash,
          slugCommitment,
          configPresetId: BigInt(selectedPreset.presetId),
        }),
      );
      const [gasHex, gasPriceHex] = await Promise.all([
        window.ethereum.request({
          method: "eth_estimateGas",
          params: [{ ...transaction, from: address }],
        }),
        window.ethereum.request({ method: "eth_gasPrice" }),
      ]);
      const gas = BigInt(gasHex as string);
      const gasPrice = BigInt(gasPriceHex as string);
      setPrepared({ transaction, metadataHash, slugCommitment, gas, gasPrice });
      setDeploymentStatus(
        "Preflight passed. Review the estimate before opening the wallet.",
      );
    } catch (error) {
      setPrepared(null);
      setDeploymentStatus(
        builderError(
          error,
          "Preflight could not complete. Check the selected network and wallet balance, then retry.",
        ),
      );
    } finally {
      setPreflightBusy(false);
    }
  }

  async function selectImage(file: File | undefined, kind: "logo" | "favicon") {
    if (!file) return;
    setImageStatus(`Preparing ${kind}`);
    try {
      const next = await prepareLaunchpadImage(file, kind);
      const current = kind === "logo" ? logo : favicon;
      if (current) URL.revokeObjectURL(current.previewUrl);
      if (kind === "logo") setLogo(next);
      else setFavicon(next);
      setImageStatus(`${kind === "logo" ? "Logo" : "Favicon"} ready`);
    } catch (error) {
      setImageStatus(
        builderError(error, "Image preparation failed. Choose another image."),
      );
    }
  }

  async function publishBranding() {
    if (
      !address ||
      !window.ethereum ||
      !configuration ||
      !prepared ||
      !createdLaunchpadId
    )
      return;
    setBrandingBusy(true);
    setDeploymentStatus("Waiting for branding signature");
    try {
      const signedAt = new Date().toISOString();
      const version = 1;
      const message = [
        "ZKBLAST Launchpad Branding",
        `Chain ID: ${configuration.chainId}`,
        `Launchpad ID: ${createdLaunchpadId}`,
        `Version: ${version}`,
        `Metadata Hash: ${prepared.metadataHash}`,
        `Signed At: ${signedAt}`,
      ].join("\n");
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
      await apiRequest(webPublicConfig.apiUrl, "/v1/launchpads/branding", {
        method: "POST",
        body: JSON.stringify({
          branding: {
            schemaVersion: 1,
            launchpadId: createdLaunchpadId,
            slug,
            name: name.trim(),
            description: description.trim(),
            primaryColor: primary.toLowerCase(),
            backgroundColor: "#090910",
            foregroundColor: "#f5f5f7",
            websiteUrl: website || "",
            xUrl: xUrl || "",
          },
          version,
          ownerAddress: address,
          signature,
          signedAt,
          logo: logo ? { mime: logo.mime, base64: logo.base64 } : null,
          favicon: favicon
            ? { mime: favicon.mime, base64: favicon.base64 }
            : null,
        }),
      });
      setBrandingPublished(true);
      setDeploymentStatus("Branding published and hosted page is ready");
      onCreated({
        launchpadId: createdLaunchpadId,
        name: name.trim(),
        slug,
        owner: address,
        treasury: effectiveTreasury,
        presetId: selectedPreset?.presetId ?? "",
        transactionHash: createdTransactionHash,
        reconciliation: "published",
      });
      toast({
        kind: "success",
        title: "Branding published",
        body: `${name.trim()} is available at /launchpads/${slug}.`,
      });
    } catch (error) {
      setDeploymentStatus(
        builderError(
          error,
          "Branding could not be published. The launchpad remains onchain; retry the signature.",
        ),
      );
    } finally {
      setBrandingBusy(false);
    }
  }

  async function configureFeePolicy() {
    if (
      !address ||
      !window.ethereum ||
      !configuration ||
      !createdLaunchpadId ||
      !feePolicyReady
    )
      return;
    setFeePolicyBusy(true);
    setDeploymentStatus("Waiting for fee policy confirmation");
    try {
      const client = new LaunchpadClient(configuration as LaunchpadAddresses);
      const transaction = contractCallTransaction(
        client.setFeePolicy({
          launchpadId: BigInt(createdLaunchpadId),
          totalTradeFeeBps,
          protocolShareBps,
          operatorShareBps,
          creatorShareBps,
          referralShareBps,
          operatorRecipient: getAddress(effectiveOperatorRecipient),
        }),
      );
      await executeTransactions(
        window.ethereum,
        address,
        configuration.chainId,
        [transaction],
        (state) => setDeploymentStatus(state.replaceAll("-", " ")),
        "Launchpad fee policy",
      );
      setFeePolicyConfigured(true);
      setDeploymentStatus(
        "Fee policy confirmed. Branding is ready to publish.",
      );
      toast({
        kind: "success",
        title: "Fee policy configured",
        body: "The launchpad revenue split is now active onchain.",
      });
    } catch (error) {
      setDeploymentStatus(
        builderError(
          error,
          "Fee policy was not configured. The launchpad remains active; retry this explicit transaction.",
        ),
      );
    } finally {
      setFeePolicyBusy(false);
    }
  }

  function domainMessage(action: "issue" | "verify", signedAt: string) {
    return [
      "ZKBLAST Launchpad Domain",
      `Action: ${action}`,
      `Chain ID: ${configuration?.chainId ?? 0}`,
      `Launchpad ID: ${createdLaunchpadId}`,
      `Hostname: ${hostname.trim().toLowerCase()}`,
      `Signed At: ${signedAt}`,
    ].join("\n");
  }

  async function signDomain(action: "issue" | "verify") {
    if (!address || !window.ethereum || !configuration || !createdLaunchpadId)
      return;
    setDomainBusy(true);
    setDeploymentStatus(
      action === "issue"
        ? "Waiting for domain authorization signature"
        : "Checking DNS ownership",
    );
    try {
      const signedAt = new Date().toISOString();
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [domainMessage(action, signedAt), address],
      })) as string;
      if (action === "issue") {
        const result = await apiRequest<{
          domainId: string;
          hostname: string;
          recordName: string;
          recordValue: string;
          expiresAt: string;
        }>(webPublicConfig.apiUrl, "/v1/launchpads/domains/challenge", {
          method: "POST",
          body: JSON.stringify({
            launchpadId: createdLaunchpadId,
            hostname: hostname.trim().toLowerCase(),
            ownerAddress: address,
            signature,
            signedAt,
          }),
        });
        setDomainChallenge(result);
        setDeploymentStatus(
          "DNS challenge ready. Add the TXT record, then verify.",
        );
      } else {
        if (!domainChallenge) return;
        await apiRequest(
          webPublicConfig.apiUrl,
          `/v1/launchpads/domains/${domainChallenge.domainId}/verify`,
          {
            method: "POST",
            body: JSON.stringify({
              ownerAddress: address,
              signature,
              signedAt,
            }),
          },
        );
        setDomainVerified(true);
        setDeploymentStatus("Custom domain ownership verified");
        toast({
          kind: "success",
          title: "Custom domain verified",
          body: `${hostname.trim().toLowerCase()} is bound to launchpad ${createdLaunchpadId}.`,
        });
      }
    } catch (error) {
      setDeploymentStatus(
        builderError(
          error,
          "Domain setup could not complete. Your launchpad and hosted page remain active.",
        ),
      );
    } finally {
      setDomainBusy(false);
    }
  }

  async function deployLaunchpad() {
    if (!address) return connect();
    if (!window.ethereum || !prepared || !configuration) return;
    setDeploymentBusy(true);
    setDeploymentStatus("Waiting for explicit wallet confirmation");
    try {
      const hash = await executeTransactions(
        window.ethereum,
        address,
        configuration.chainId,
        [prepared.transaction],
        (state) => setDeploymentStatus(state.replaceAll("-", " ")),
        "Launchpad deployment",
      );
      const receipt = (await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as {
        logs?: readonly Readonly<{
          address: string;
          data: `0x${string}`;
          topics: [] | [`0x${string}`, ...`0x${string}`[]];
        }>[];
      } | null;
      const event = receipt?.logs
        ?.filter(
          (log) =>
            log.address.toLowerCase() === configuration.registry.toLowerCase(),
        )
        .map((log) => {
          try {
            return decodeEventLog({
              abi: launchpadRegistryAbi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            return null;
          }
        })
        .find((item) => item?.eventName === "LaunchpadCreated");
      if (!event || event.eventName !== "LaunchpadCreated")
        throw new Error("LAUNCHPAD_CREATED_EVENT_NOT_FOUND");
      const launchpadId = event.args.launchpadId.toString();
      setCreatedLaunchpadId(launchpadId);
      setCreatedTransactionHash(hash);
      const optimistic: PendingLaunchpad = {
        launchpadId,
        name: name.trim(),
        slug,
        owner: address,
        treasury: effectiveTreasury,
        presetId: selectedPreset!.presetId,
        transactionHash: hash,
        reconciliation: "confirmed",
      };
      onCreated(optimistic);
      for (const [index, delay] of [0, 3_000, 8_000, 15_000].entries()) {
        window.setTimeout(() => {
          void reconcileLaunchpad(optimistic, index === 3);
        }, delay);
      }
      setDeploymentStatus(
        "Launchpad confirmed onchain. Branding publication can continue from the owner dashboard.",
      );
      toast({
        kind: "success",
        title: "Launchpad created",
        body: `Launchpad ${event.args.launchpadId.toString()} confirmed onchain.`,
      });
    } catch (error) {
      setDeploymentStatus(
        builderError(
          error,
          "Deployment did not complete. No second transaction will be sent automatically; rerun preflight before retrying.",
        ),
      );
    } finally {
      setDeploymentBusy(false);
    }
  }

  async function reconcileLaunchpad(
    item: PendingLaunchpad,
    finalAttempt: boolean,
  ) {
    try {
      await apiRequest(
        webPublicConfig.apiUrl,
        `/v1/launchpads/records/${item.launchpadId}`,
        { cache: "no-store" },
      );
      let published = false;
      try {
        await apiRequest(
          webPublicConfig.apiUrl,
          `/v1/launchpads/${encodeURIComponent(item.slug)}`,
          { cache: "no-store" },
        );
        published = true;
      } catch {
        // Branding publication follows the onchain creation transaction.
      }
      onCreated({
        ...item,
        reconciliation: published ? "published" : "onchain",
      });
    } catch {
      if (finalAttempt) onCreated({ ...item, reconciliation: "failed" });
    }
  }

  return (
    <section className="panel ticks overflow-hidden">
      <div className="grid border-b border-line sm:grid-cols-4">
        {steps.map((label, index) => (
          <button
            key={label}
            onClick={() =>
              !createdLaunchpadId && index <= step && setStep(index)
            }
            disabled={index > step || Boolean(createdLaunchpadId)}
            className={`flex min-h-14 items-center justify-center gap-2 border-b-2 px-3 font-mono text-[10px] uppercase ${index === step ? "border-lime bg-white/[.04]" : "border-transparent text-muted"}`}
          >
            {completion[index] && <Check className="size-3 text-lime" />}
            {index + 1}. {label}
          </button>
        ))}
      </div>
      <div className="grid min-h-[36rem] lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="border-b border-line p-5 sm:p-8 lg:border-b-0 lg:border-r">
          {step === 0 && (
            <div className="mx-auto max-w-2xl">
              <p className="label">Identity and branding</p>
              <h2 className="mt-3 text-2xl">
                How should users recognize this launchpad?
              </h2>
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Launchpad name"
                  value={name}
                  onChange={setName}
                  placeholder="Alpha Markets"
                />
                <Field
                  label="URL slug"
                  value={slug}
                  onChange={(value) =>
                    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))
                  }
                  placeholder="alpha-markets"
                />
                <label className="sm:col-span-2">
                  <span className="label">Description</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                    rows={4}
                    className="mt-2 w-full border border-line bg-bg p-3 text-sm outline-none focus:border-lime/60"
                    placeholder="Explain what this launchpad publishes."
                  />
                </label>
                <Field
                  label="Website (optional)"
                  value={website}
                  onChange={setWebsite}
                  placeholder="https://example.com"
                />
                <Field
                  label="X profile (optional)"
                  value={xUrl}
                  onChange={setXUrl}
                  placeholder="https://x.com/example"
                />
                <label className="sm:col-span-2">
                  <span className="label">Custom domain (optional)</span>
                  <input
                    value={hostname}
                    onChange={(event) =>
                      setHostname(
                        event.target.value
                          .trim()
                          .toLowerCase()
                          .replace(/^https?:\/\//u, "")
                          .replace(/\/$/u, ""),
                      )
                    }
                    placeholder="launch.example.com"
                    className="mt-2 h-12 w-full border border-line bg-bg px-3 text-sm outline-none focus:border-lime/60"
                  />
                  <span className="mt-2 block text-[11px] leading-5 text-muted">
                    DNS verification starts only after deployment. Leave empty
                    to use the hosted ZKBLAST URL.
                  </span>
                </label>
                <label>
                  <span className="label">Accent color</span>
                  <span className="mt-2 flex h-12 items-center gap-3 border border-line bg-bg px-3">
                    <input
                      type="color"
                      value={primary}
                      onChange={(event) => setPrimary(event.target.value)}
                      className="size-7 bg-transparent"
                    />
                    <span className="font-mono text-xs">{primary}</span>
                  </span>
                </label>
                <ImageField
                  label="Logo (optional)"
                  previewUrl={logo?.previewUrl}
                  onSelect={(file) => void selectImage(file, "logo")}
                />
                <ImageField
                  label="Favicon (optional)"
                  previewUrl={favicon?.previewUrl}
                  onSelect={(file) => void selectImage(file, "favicon")}
                />
                {imageStatus && (
                  <p
                    role="status"
                    className="font-mono text-[10px] text-muted sm:col-span-2"
                  >
                    {imageStatus}
                  </p>
                )}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="mx-auto max-w-2xl">
              <p className="label">Onchain control</p>
              <h2 className="mt-3 text-2xl">Confirm owner and treasury.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                The connected wallet becomes the initial owner. Treasury
                receives the configured launchpad revenue share and must be
                checked before signing.
              </p>
              <div className="mt-7 space-y-5">
                <ReadOnlyField label="Owner" value={owner} />
                <Field
                  label="Treasury"
                  value={treasury}
                  onChange={setTreasury}
                  placeholder={address ?? "0x..."}
                />
                <div className="border border-line p-4 text-xs leading-5 text-muted">
                  <ShieldCheck className="mb-2 size-5 text-lime" />
                  Changing owner or treasury later uses the registry’s explicit
                  two-step proposal and acceptance flow.
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="mx-auto max-w-2xl">
              <p className="label">Approved economics</p>
              <h2 className="mt-3 text-2xl">Choose a governed preset.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                Only enabled presets read from the deployed Config Manager are
                selectable. Quote token, fee cap and graduation destination are
                fixed by the selected snapshot.
              </p>
              {catalogLoading ? (
                <div className="mt-7 space-y-3">
                  <Skeleton className="h-36" />
                  <Skeleton className="h-36" />
                </div>
              ) : catalogError ? (
                <div
                  role="alert"
                  className="mt-7 border border-danger/50 p-4 text-sm text-danger"
                >
                  Approved presets unavailable · {catalogError}
                </div>
              ) : presets.length === 0 ? (
                <div className="mt-7 border border-line p-5 text-sm text-muted">
                  No enabled launchpad preset is available on this network.
                </div>
              ) : (
                <div className="mt-7 grid gap-3">
                  {presets.map((preset) => (
                    <button
                      key={preset.presetId}
                      onClick={() => setPresetId(preset.presetId)}
                      className={`p-5 text-left ${presetId === preset.presetId ? "border border-lime bg-white/[.03]" : "border border-line hover:border-lime/50"}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-mono text-sm">
                            Preset {preset.presetId} · version {preset.version}
                          </p>
                          <p className="mt-2 break-all font-mono text-[10px] text-muted">
                            Config {preset.configHash}
                          </p>
                        </div>
                        {presetId === preset.presetId && (
                          <Check className="size-5 shrink-0 text-lime" />
                        )}
                      </div>
                      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5 text-xs">
                        <dt className="text-muted">Quote token</dt>
                        <dd className="break-all text-right font-mono">
                          {preset.quoteToken}
                        </dd>
                        <dt className="text-muted">DBC template</dt>
                        <dd className="text-right">{preset.dbcTemplateId}</dd>
                        <dt className="text-muted">Maximum fee</dt>
                        <dd className="text-right">
                          {(preset.maximumTotalTradeFeeBps / 100).toFixed(2)}%
                        </dd>
                        <dt className="text-muted">Graduation</dt>
                        <dd className="text-right">
                          {preset.graduationDestination === 1
                            ? "DAMM"
                            : preset.graduationDestination === 2
                              ? "DLMM"
                              : "Unavailable"}
                        </dd>
                        <dt className="text-muted">Creator access</dt>
                        <dd className="text-right">
                          {preset.creatorAccess === 0
                            ? "Owner / operator"
                            : "Permissionless"}
                        </dd>
                        <dt className="text-muted">Editable after use</dt>
                        <dd className="text-right">No</dd>
                      </dl>
                    </button>
                  ))}
                </div>
              )}
              {!graduationCapabilities.dlmmGraduation && (
                <p className="mt-3 text-xs text-muted">
                  DLMM graduation is hidden until the current network reports an
                  executable, governance-enabled adapter.
                </p>
              )}
              <div className="mt-7 border border-line p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="label">Revenue policy</p>
                    <p className="mt-2 text-sm text-muted">
                      Split every collected fee. The four shares must total
                      exactly 100%.
                    </p>
                  </div>
                  <span
                    className={`font-mono text-xs ${feeShareTotal === 10_000 ? "text-lime" : "text-danger"}`}
                  >
                    {(feeShareTotal / 100).toFixed(2)}% / 100%
                  </span>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <FeeField
                    label="Total trade fee"
                    valueBps={totalTradeFeeBps}
                    onChange={setTotalTradeFeeBps}
                    maximumBps={selectedPreset?.maximumTotalTradeFeeBps ?? 300}
                  />
                  <FeeField
                    label="Protocol share"
                    valueBps={protocolShareBps}
                    onChange={setProtocolShareBps}
                  />
                  <FeeField
                    label="Operator share"
                    valueBps={operatorShareBps}
                    onChange={setOperatorShareBps}
                  />
                  <FeeField
                    label="Creator share"
                    valueBps={creatorShareBps}
                    onChange={setCreatorShareBps}
                  />
                  <FeeField
                    label="Referral share"
                    valueBps={referralShareBps}
                    onChange={setReferralShareBps}
                  />
                  <div className="sm:col-span-2">
                    <Field
                      label="Operator fee recipient"
                      value={operatorRecipient}
                      onChange={setOperatorRecipient}
                      placeholder={effectiveTreasury}
                    />
                    <p className="mt-2 text-[11px] leading-5 text-muted">
                      Leave empty to use the treasury. A non-zero referral share
                      requires a referral recipient when each token is created.
                    </p>
                  </div>
                </div>
                {!feePolicyReady && (
                  <p role="alert" className="mt-4 text-xs text-danger">
                    Use a valid recipient, keep the trade fee within the
                    selected preset cap, and make shares total 100%.
                  </p>
                )}
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="mx-auto max-w-2xl">
              <p className="label">Review before wallet</p>
              <h2 className="mt-3 text-2xl">
                Verify every value before deployment.
              </h2>
              <dl className="mt-7 divide-y divide-line border border-line text-sm">
                <ReviewRow label="Name" value={name} />
                <ReviewRow label="Hosted URL" value={`/launchpads/${slug}`} />
                <ReviewRow
                  label="Custom domain"
                  value={hostname || "Hosted URL only"}
                />
                <ReviewRow label="Owner" value={owner} />
                <ReviewRow label="Treasury" value={effectiveTreasury} />
                <ReviewRow
                  label="Network"
                  value={
                    configuration
                      ? `${configuration.environment} · ${configuration.chainId}`
                      : config
                        ? `${config.chainName} · ${config.chainId}`
                        : "Loading network"
                  }
                />
                <ReviewRow
                  label="Preset"
                  value={
                    selectedPreset
                      ? `Preset ${selectedPreset.presetId} · config ${selectedPreset.configHash}`
                      : "Unavailable"
                  }
                />
                <ReviewRow
                  label="Trade fee"
                  value={`${(totalTradeFeeBps / 100).toFixed(2)}% · cap ${((selectedPreset?.maximumTotalTradeFeeBps ?? 0) / 100).toFixed(2)}%`}
                />
                <ReviewRow
                  label="Fee shares"
                  value={`Protocol ${(protocolShareBps / 100).toFixed(2)}% · Operator ${(operatorShareBps / 100).toFixed(2)}% · Creator ${(creatorShareBps / 100).toFixed(2)}% · Referral ${(referralShareBps / 100).toFixed(2)}%`}
                />
                <ReviewRow
                  label="Operator recipient"
                  value={effectiveOperatorRecipient}
                />
                <ReviewRow
                  label="Factory"
                  value={configuration?.factory ?? "Unavailable"}
                />
                <ReviewRow
                  label="Config Manager"
                  value={configuration?.configManager ?? "Unavailable"}
                />
              </dl>
              {prepared && (
                <dl className="mt-5 divide-y divide-line border border-line text-sm">
                  <ReviewRow
                    label="Metadata hash"
                    value={prepared.metadataHash}
                  />
                  <ReviewRow
                    label="Slug commitment"
                    value={prepared.slugCommitment}
                  />
                  <ReviewRow
                    label="Estimated gas"
                    value={prepared.gas.toString()}
                  />
                  <ReviewRow
                    label="Estimated network fee"
                    value={`${formatEther(prepared.gas * prepared.gasPrice)} ETH`}
                  />
                  <ReviewRow label="Expected event" value="LaunchpadCreated" />
                </dl>
              )}
              {deploymentStatus && (
                <p
                  role="status"
                  className="mt-4 break-words border border-line p-3 text-xs text-muted"
                >
                  {deploymentStatus}
                </p>
              )}
              {createdLaunchpadId ? (
                <div className="mt-5 border border-lime p-4">
                  <p className="font-mono text-sm">
                    Launchpad {createdLaunchpadId} confirmed
                  </p>
                  {brandingPublished ? (
                    <div className="mt-4">
                      <div className="flex flex-wrap gap-4 text-xs">
                        <a
                          href={`/launchpads/${slug}`}
                          className="flex items-center gap-2 text-lime"
                        >
                          Open hosted page <ExternalLink className="size-3" />
                        </a>
                        <button
                          onClick={onOpenManage}
                          className="text-muted hover:text-fg"
                        >
                          Open owner dashboard
                        </button>
                      </div>
                      {hostname && !domainChallenge && (
                        <button
                          onClick={() => void signDomain("issue")}
                          disabled={domainBusy}
                          className="mt-4 w-full border border-line py-3 font-mono text-xs uppercase disabled:opacity-40"
                        >
                          {domainBusy
                            ? "Waiting for signature"
                            : "Configure custom domain"}
                        </button>
                      )}
                      {domainChallenge && !domainVerified && (
                        <div className="mt-4 border border-line p-4">
                          <p className="label">Add this DNS TXT record</p>
                          <dl className="mt-3 space-y-3 text-xs">
                            <div>
                              <dt className="text-muted">Name</dt>
                              <dd className="mt-1 break-all font-mono">
                                {domainChallenge.recordName}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">Value</dt>
                              <dd className="mt-1 break-all font-mono">
                                {domainChallenge.recordValue}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">Expires</dt>
                              <dd className="mt-1 font-mono">
                                {new Date(
                                  domainChallenge.expiresAt,
                                ).toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                          <button
                            onClick={() => void signDomain("verify")}
                            disabled={domainBusy}
                            className="mt-4 w-full bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
                          >
                            {domainBusy ? "Checking DNS" : "Verify DNS record"}
                          </button>
                        </div>
                      )}
                      {domainVerified && (
                        <p className="mt-4 border border-lime p-3 text-xs text-lime">
                          Custom domain verified · {hostname}
                        </p>
                      )}
                    </div>
                  ) : !feePolicyConfigured ? (
                    <div className="mt-4">
                      <p className="text-xs leading-5 text-muted">
                        Confirm the reviewed fee policy in one explicit onchain
                        transaction.
                      </p>
                      <button
                        onClick={() => void configureFeePolicy()}
                        disabled={feePolicyBusy || !feePolicyReady}
                        className="mt-3 w-full bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
                      >
                        {feePolicyBusy
                          ? "Waiting for wallet"
                          : "Configure fee policy"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-xs leading-5 text-muted">
                        Sign the committed branding to publish the hosted page.
                        This signature does not spend gas.
                      </p>
                      <button
                        onClick={() => void publishBranding()}
                        disabled={brandingBusy}
                        className="mt-3 w-full bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
                      >
                        {brandingBusy
                          ? "Waiting for signature"
                          : "Sign and publish branding"}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => void prepareDeployment()}
                    disabled={
                      preflightBusy ||
                      deploymentBusy ||
                      !selectedPreset ||
                      !configuration
                    }
                    className="border border-line py-4 font-mono text-xs uppercase disabled:opacity-40"
                  >
                    {preflightBusy
                      ? "Running preflight"
                      : prepared
                        ? "Refresh preflight"
                        : "Run preflight"}
                  </button>
                  <button
                    onClick={() => void deployLaunchpad()}
                    disabled={!prepared || preflightBusy || deploymentBusy}
                    className="bg-lime py-4 font-mono text-xs uppercase text-lime-ink disabled:opacity-40"
                  >
                    {deploymentBusy ? "Waiting for wallet" : "Deploy launchpad"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="p-5 sm:p-7">
          <p className="label">Live preview</p>
          <div
            className="mt-4 min-h-72 border border-line p-5"
            style={{ borderTopColor: primary }}
          >
            <div className="flex items-center gap-3">
              {logo ? (
                <img
                  src={logo.previewUrl}
                  alt="Selected launchpad logo"
                  className="size-11 rounded-full border border-line object-cover"
                />
              ) : (
                <div
                  className="grid size-11 place-items-center rounded-full border border-line font-mono text-sm"
                  style={{ color: primary }}
                >
                  {name.slice(0, 1).toUpperCase() || "L"}
                </div>
              )}
              <div>
                <p className="font-mono text-sm">{name || "Your launchpad"}</p>
                <p className="mt-1 font-mono text-[9px] uppercase text-muted">
                  Powered by ZKBLAST
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-muted">
              {description || "Your description will appear here."}
            </p>
            <div className="mt-8 h-1 bg-raised">
              <div
                className="h-full w-2/3"
                style={{ backgroundColor: primary }}
              />
            </div>
          </div>
          <div className="mt-4 border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="label">Onchain bonding curve</p>
                <p className="mt-1 text-[10px] text-muted">
                  Linear price model from the selected immutable template.
                </p>
              </div>
              <span className="font-mono text-[9px] text-muted">
                Template {selectedPreset?.dbcTemplateId ?? "—"}
              </span>
            </div>
            {curvePath && curveFacts ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
                  {[
                    ["Start price", `${curveFacts.startPrice} USDG`],
                    ["Terminal price", `${curveFacts.terminalPrice} USDG`],
                    ["Sale capacity", `${curveFacts.saleCapacity} tokens`],
                    [
                      "Graduation reserve",
                      `${curveFacts.graduationReserve} USDG`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-bg p-3">
                      <p className="font-mono text-[8px] uppercase text-muted">
                        {label}
                      </p>
                      <p className="mt-1.5 font-mono text-[10px] text-fg">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <svg
                  viewBox="0 0 100 100"
                  role="img"
                  aria-label={`Linear onchain template curve from ${curveFacts.startPrice} to ${curveFacts.terminalPrice} USDG`}
                  className="mt-3 h-36 w-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  {[10, 50, 90].map((y) => (
                    <path
                      key={y}
                      d={`M 4 ${y} L 96 ${y}`}
                      fill="none"
                      stroke="currentColor"
                      className="text-line"
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <path
                    d={curvePath}
                    fill="none"
                    stroke={primary}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  {curvePreview.map((point, index) => {
                    if (
                      index !== 0 &&
                      index !== curvePreview.length - 1 &&
                      index % 4 !== 0
                    )
                      return null;
                    const minimum =
                      curvePreview.at(0)?.priceX18 ?? point.priceX18;
                    const maximum =
                      curvePreview.at(-1)?.priceX18 ?? point.priceX18;
                    const range = maximum > minimum ? maximum - minimum : 1n;
                    const normalized =
                      Number(((point.priceX18 - minimum) * 10_000n) / range) /
                      100;
                    const y = 90 - normalized * 0.8;
                    return (
                      <circle
                        key={point.progressBps}
                        cx={4 + (index * 92) / (curvePreview.length - 1)}
                        cy={y}
                        r="1.25"
                        fill={primary}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
                <div className="mt-2 flex justify-between font-mono text-[9px] text-muted">
                  <span>0% of curve inventory sold</span>
                  <span>100% sold</span>
                </div>
                <p className="mt-3 border-t border-line pt-3 text-[10px] leading-5 text-muted">
                  Previewed from the onchain template parameters. Executable
                  quotes also account for current sold supply, trade fee and
                  slippage.
                </p>
              </>
            ) : (
              <Skeleton className="mt-4 h-32" />
            )}
          </div>
          <div className="mt-5 space-y-2 font-mono text-[10px] text-muted">
            <p>Route · /launch?launchpad={slug || "your-slug"}</p>
            <p>Hosted · /launchpads/{slug || "your-slug"}</p>
            <p>Network · {config?.environment ?? "loading"}</p>
          </div>
          {slug && (
            <button
              onClick={onOpenMarkets}
              className="mt-5 flex items-center gap-2 text-xs text-muted hover:text-fg"
            >
              Return to markets <ExternalLink className="size-3" />
            </button>
          )}
        </aside>
      </div>
      <div className="flex justify-between border-t border-line p-4">
        <button
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0 || Boolean(createdLaunchpadId)}
          className="flex items-center gap-2 border border-line px-4 py-3 font-mono text-xs uppercase disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        {!address && step === 1 ? (
          <button
            onClick={() => void connect()}
            className="bg-lime px-5 py-3 font-mono text-xs uppercase text-lime-ink"
          >
            Connect wallet
          </button>
        ) : step < steps.length - 1 ? (
          <button
            onClick={() => canContinue && setStep((value) => value + 1)}
            disabled={!canContinue}
            className="flex items-center gap-2 bg-lime px-5 py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-30"
          >
            Continue
            <ChevronRight className="size-4" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ImageField({
  label,
  previewUrl,
  onSelect,
}: Readonly<{
  label: string;
  previewUrl?: string;
  onSelect: (file: File | undefined) => void;
}>) {
  return (
    <label>
      <span className="label">{label}</span>
      <span className="mt-2 flex h-12 cursor-pointer items-center gap-3 border border-line bg-bg px-3 text-xs text-muted hover:border-lime/50">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <ImagePlus className="size-4" />
        )}
        <span>{previewUrl ? "Replace image" : "Choose image"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => onSelect(event.target.files?.[0])}
        />
      </span>
    </label>
  );
}

function FeeField({
  label,
  valueBps,
  onChange,
  maximumBps = 10_000,
}: Readonly<{
  label: string;
  valueBps: number;
  onChange: (value: number) => void;
  maximumBps?: number;
}>) {
  return (
    <label>
      <span className="label">{label}</span>
      <span className="mt-2 flex h-12 items-center border border-line bg-bg px-3 focus-within:border-lime/60">
        <input
          type="number"
          min="0"
          max={(maximumBps / 100).toString()}
          step="0.01"
          value={valueBps / 100}
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value);
            onChange(Number.isFinite(value) ? Math.round(value * 100) : 0);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="font-mono text-xs text-muted">%</span>
      </span>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}>) {
  return (
    <label>
      <span className="label">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full border border-line bg-bg px-3 text-sm outline-none focus:border-lime/60"
      />
    </label>
  );
}
function ReadOnlyField({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-2 break-all border border-line bg-bg p-3 font-mono text-xs">
        {value}
      </p>
    </div>
  );
}
function ReviewRow({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all font-mono text-xs sm:text-right">{value}</dd>
    </div>
  );
}
