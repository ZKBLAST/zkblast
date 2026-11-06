"use client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, getAddress, zeroAddress } from "viem";
import {
  formatTokenAmount,
  LaunchpadClient,
  minimumAmountOut,
  parseTokenAmount,
  ProtectedLaunchClient,
  type DbcAddresses,
  type LaunchpadAddresses,
} from "@zkblast/sdk";
import { dbcEventsAbi, protectedLaunchFactoryAbi } from "@zkblast/abi";
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
import type {
  DbcLaunch,
  DbcTemplate,
  ProtectedLaunchPreview,
  ProtectionPolicy,
  StockQuoteAssetView,
  StockQuoteDestinationView,
  TemplateEconomics,
} from "./types";
import { prepareLaunchLogo } from "@/lib/launch-metadata";
import { StockQuoteAssetSummary } from "./StockQuoteAssetSummary";

type PendingInitialBuy = Readonly<{
  pool: `0x${string}`;
  quoteToken: `0x${string}`;
  recipient: `0x${string}`;
  amountRaw: bigint;
  symbol: string;
  quoteSymbol: string;
  quoteDecimals: number;
  phase: "approve" | "buy";
}>;

type LaunchpadRecord = Readonly<{
  configPresetId: string;
}>;

type LaunchpadPreset = Readonly<{
  presetId: string;
  dbcTemplateId: string;
  graduationDestination: number;
}>;

export function LaunchWizard({
  open,
  onClose,
  templates,
  deployment,
  launchpadId,
  onComplete,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  templates: readonly DbcTemplate[];
  deployment: DbcAddresses;
  launchpadId?: string | undefined;
  onComplete: (launch?: DbcLaunch) => void;
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
  const [submitting, setSubmitting] = useState(false);
  const [economics, setEconomics] = useState<TemplateEconomics | null>(null);
  const [economicsLoading, setEconomicsLoading] = useState(false);
  const [stockQuoteAsset, setStockQuoteAsset] =
    useState<StockQuoteAssetView | null>(null);
  const [stockDestinations, setStockDestinations] = useState<
    readonly StockQuoteDestinationView[]
  >([]);
  const [stockQuoteCatalog, setStockQuoteCatalog] = useState<
    readonly StockQuoteAssetView[]
  >([]);
  const [stockQuoteCatalogLoading, setStockQuoteCatalogLoading] =
    useState(false);
  const [stockCatalogQuery, setStockCatalogQuery] = useState("");
  const [catalogStockAddress, setCatalogStockAddress] = useState("");
  const [stockTemplateIds, setStockTemplateIds] = useState<
    Readonly<Record<string, Partial<Record<"damm" | "dlmm", string>>>>
  >({});
  const [catalogStockDestinations, setCatalogStockDestinations] = useState<
    readonly StockQuoteDestinationView[]
  >([]);
  const [catalogStockDestinationsLoading, setCatalogStockDestinationsLoading] =
    useState(false);
  const [launchProtection, setLaunchProtection] = useState<
    "standard" | "protected"
  >("standard");
  const [protectionPolicies, setProtectionPolicies] = useState<
    readonly ProtectionPolicy[]
  >([]);
  const [protectionPolicyId, setProtectionPolicyId] = useState("");
  const [protectionPreview, setProtectionPreview] =
    useState<ProtectedLaunchPreview | null>(null);
  const [protectionLoading, setProtectionLoading] = useState(false);
  const [pendingInitialBuy, setPendingInitialBuy] =
    useState<PendingInitialBuy | null>(null);
  const [launchpadConfiguration, setLaunchpadConfiguration] =
    useState<LaunchpadAddresses | null>(null);
  const [launchpadPreset, setLaunchpadPreset] =
    useState<LaunchpadPreset | null>(null);
  const [initialBuyBusy, setInitialBuyBusy] = useState(false);
  const [initialBuyStatus, setInitialBuyStatus] = useState("");
  const selected = useMemo(
    () => templates.find((item) => item.template_id === templateId),
    [templates, templateId],
  );
  const walletRecipient = recipient || address || "";
  const quoteSymbol = economics?.quoteSymbol ?? "Quote token";
  const quoteDecimals = economics?.quoteDecimals ?? 18;
  const selectedMigrationMode =
    economics?.migrationMode === 1 ? "dlmm" : "damm";
  const filteredStockQuoteCatalog = useMemo(() => {
    const query = stockCatalogQuery.trim().toLowerCase();
    if (!query) return stockQuoteCatalog;
    return stockQuoteCatalog.filter((asset) =>
      [
        asset.symbol,
        asset.instrumentName,
        asset.issuerName,
        asset.contractAddress,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [stockCatalogQuery, stockQuoteCatalog]);
  const catalogStockAsset = useMemo(
    () =>
      stockQuoteCatalog.find(
        (asset) => asset.contractAddress === catalogStockAddress,
      ) ?? null,
    [catalogStockAddress, stockQuoteCatalog],
  );
  const displayedStockAsset = stockQuoteAsset ?? catalogStockAsset;
  const displayedStockDestinations = stockQuoteAsset
    ? stockDestinations
    : catalogStockDestinations;
  const stockQuoteTemplateSelected = stockQuoteAsset !== null;
  const launchpadTemplateMismatch = Boolean(
    launchpadPreset && selected?.template_id !== launchpadPreset.dbcTemplateId,
  );
  const stockTemplateAvailable =
    !stockQuoteAsset || stockQuoteAsset.quoteTradingEnabled;
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
  }, [config?.chainId, templateId]);
  useEffect(() => {
    if (!open || config?.chainId !== 4663) {
      setStockQuoteCatalog([]);
      setStockQuoteCatalogLoading(false);
      return;
    }
    const controller = new AbortController();
    setStockQuoteCatalogLoading(true);
    void apiRequest<{ items: readonly StockQuoteAssetView[] }>(
      webPublicConfig.apiUrl,
      "/v1/stock-quotes/assets?limit=100",
      { signal: controller.signal, cache: "no-store" },
    )
      .then(({ items }) => {
        setStockQuoteCatalog(items);
        setCatalogStockAddress((current) =>
          current && items.some((item) => item.contractAddress === current)
            ? current
            : (items[0]?.contractAddress ?? ""),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setStockQuoteCatalog([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStockQuoteCatalogLoading(false);
      });
    return () => controller.abort();
  }, [config?.chainId, open]);
  useEffect(() => {
    if (!stockQuoteTemplateSelected) return;
    setLaunchProtection("protected");
    setInitialBuy("");
  }, [stockQuoteTemplateSelected]);
  useEffect(() => {
    if (!open || config?.chainId !== 4663) {
      setStockTemplateIds({});
      return;
    }
    const controller = new AbortController();
    void Promise.all(
      templates
        .filter((item) => item.enabled)
        .map(async (item) => ({
          templateId: item.template_id,
          economics: await apiRequest<TemplateEconomics>(
            webPublicConfig.apiUrl,
            `/v1/dbc/templates/${item.template_id}/economics`,
            { signal: controller.signal, cache: "no-store" },
          ),
        })),
    )
      .then((items) => {
        const byAsset: Record<
          string,
          Partial<Record<"damm" | "dlmm", string>>
        > = {};
        for (const item of items) {
          const asset = item.economics.quoteToken.toLowerCase();
          const mode = item.economics.migrationMode === 1 ? "dlmm" : "damm";
          byAsset[asset] = { ...byAsset[asset], [mode]: item.templateId };
        }
        setStockTemplateIds(byAsset);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStockTemplateIds({});
      });
    return () => controller.abort();
  }, [config?.chainId, open, templates]);
  useEffect(() => {
    if (!catalogStockAddress || config?.chainId !== 4663) {
      setCatalogStockDestinations([]);
      setCatalogStockDestinationsLoading(false);
      return;
    }
    const controller = new AbortController();
    setCatalogStockDestinations([]);
    setCatalogStockDestinationsLoading(true);
    void apiRequest<{ items: readonly StockQuoteDestinationView[] }>(
      webPublicConfig.apiUrl,
      `/v1/stock-quotes/assets/${catalogStockAddress}/destinations`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(({ items }) => setCatalogStockDestinations(items))
      .catch(() => {
        if (!controller.signal.aborted) setCatalogStockDestinations([]);
      })
      .finally(() => {
        if (!controller.signal.aborted)
          setCatalogStockDestinationsLoading(false);
      });
    return () => controller.abort();
  }, [catalogStockAddress, config?.chainId]);
  useEffect(() => {
    const quoteToken = economics?.quoteToken;
    if (!quoteToken || config?.chainId !== 4663) {
      setStockQuoteAsset(null);
      setStockDestinations([]);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      apiRequest<StockQuoteAssetView>(
        webPublicConfig.apiUrl,
        `/v1/stock-quotes/assets/${quoteToken}`,
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<{ items: readonly StockQuoteDestinationView[] }>(
        webPublicConfig.apiUrl,
        `/v1/stock-quotes/assets/${quoteToken}/destinations`,
        { signal: controller.signal, cache: "no-store" },
      ),
    ])
      .then(([asset, destinations]) => {
        setStockQuoteAsset(asset);
        setStockDestinations(destinations.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStockQuoteAsset(null);
          setStockDestinations([]);
        }
      });
    return () => controller.abort();
  }, [config?.chainId, economics?.quoteToken]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void apiRequest<{ items: readonly ProtectionPolicy[] }>(
      webPublicConfig.apiUrl,
      "/v1/dbc/protection/policies?limit=100",
      { signal: controller.signal, cache: "no-store" },
    )
      .then(({ items }) => {
        // `used` makes a policy immutable/auditable; it does not make the
        // policy single-use. Every enabled policy remains selectable.
        const available = items.filter((item) => item.enabled);
        setProtectionPolicies(available);
        setProtectionPolicyId(
          (current) => current || available[0]?.policy_id || "",
        );
      })
      .catch(() => setProtectionPolicies([]));
    return () => controller.abort();
  }, [config?.chainId, open]);
  useEffect(() => {
    if (
      launchProtection !== "protected" ||
      !protectionPolicyId ||
      !economics ||
      !config
    ) {
      setProtectionPreview(null);
      return;
    }
    const controller = new AbortController();
    setProtectionLoading(true);
    void window.ethereum
      ?.request({ method: "eth_blockNumber" })
      .then((block) =>
        apiRequest<ProtectedLaunchPreview>(
          webPublicConfig.apiUrl,
          "/v1/dbc/protection/preview",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              policyId: protectionPolicyId,
              baseInventoryRaw: economics.baseInventoryRaw,
              currentBlock: BigInt(String(block)).toString(),
            }),
          },
        ),
      )
      .then(setProtectionPreview)
      .catch(() => setProtectionPreview(null))
      .finally(() => {
        if (!controller.signal.aborted) setProtectionLoading(false);
      });
    return () => controller.abort();
  }, [config, economics, launchProtection, protectionPolicyId]);
  useEffect(() => {
    if (!open || !launchpadId) {
      setLaunchpadConfiguration(null);
      setLaunchpadPreset(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      apiRequest<LaunchpadAddresses>(
        webPublicConfig.apiUrl,
        "/v1/launchpads/configuration",
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<LaunchpadRecord>(
        webPublicConfig.apiUrl,
        `/v1/launchpads/records/${launchpadId}`,
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<{ items: readonly LaunchpadPreset[] }>(
        webPublicConfig.apiUrl,
        "/v1/launchpads/presets",
        { signal: controller.signal, cache: "no-store" },
      ),
    ])
      .then(([configuration, record, presets]) => {
        const preset =
          presets.items.find(
            (item) => item.presetId === record.configPresetId,
          ) ?? null;
        setLaunchpadConfiguration(configuration);
        setLaunchpadPreset(preset);
        if (preset) setTemplateId(preset.dbcTemplateId);
      })
      .catch(() => {
        setLaunchpadConfiguration(null);
        setLaunchpadPreset(null);
      });
    return () => controller.abort();
  }, [config?.chainId, launchpadId, open]);
  const validWebsite = !websiteUrl || /^https:\/\/.+/u.test(websiteUrl);
  const validX =
    !xUrl || /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/.+/iu.test(xUrl);
  const initialBuyRaw = useMemo(() => {
    try {
      return initialBuy ? parseTokenAmount(initialBuy, quoteDecimals) : 0n;
    } catch {
      return -1n;
    }
  }, [initialBuy, quoteDecimals]);
  const validInitialBuy =
    launchProtection === "protected"
      ? initialBuyRaw === 0n
      : initialBuyRaw >= 0n &&
        (initialBuyRaw === 0n ||
          (economics !== null &&
            initialBuyRaw <= BigInt(economics.graduationThresholdRaw)));
  const canContinue =
    step === 0
      ? Boolean(selected) &&
        stockTemplateAvailable &&
        !launchpadTemplateMismatch
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
    if (launchpadTemplateMismatch)
      return setStatus("LAUNCHPAD_PRESET_TEMPLATE_MISMATCH");
    if (!window.ethereum || !config || !selected) return;
    if (launchProtection === "protected" && !deployment.protectedLaunch)
      return setStatus("PROTECTED_DEPLOYMENT_NOT_CONFIGURED");
    if (stockQuoteTemplateSelected && launchProtection !== "protected")
      return setStatus("STOCK_QUOTE_REQUIRES_PROTECTED_LAUNCH");
    if (
      stockQuoteTemplateSelected &&
      !stockDestinations.some(
        (item) => item.migrationMode === selectedMigrationMode && item.enabled,
      )
    )
      return setStatus("STOCK_QUOTE_DESTINATION_NOT_ENABLED");
    setSubmitting(true);
    setStatus("preparing");
    let launchCreated = false;
    try {
      const metadata = await apiRequest<{
        metadataId: string;
        metadataUri: string;
        logoUrl: string | null;
      }>(webPublicConfig.apiUrl, "/v1/dbc/metadata", {
        method: "POST",
        body: JSON.stringify({
          websiteUrl,
          xUrl,
          logoMime: logo?.mime ?? null,
          logoBase64: logo?.base64 ?? null,
        }),
      });
      const salt = bytes32Salt();
      if (launchpadId && !launchpadConfiguration)
        throw new Error("LAUNCHPAD_CONFIGURATION_UNAVAILABLE");
      const launchRequest = {
        templateId: BigInt(selected.template_id),
        salt,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        metadataUri: metadata.metadataUri,
        creatorTokenRecipient: getAddress(walletRecipient),
      } as const;
      const call =
        launchProtection === "protected"
          ? launchpadId
            ? new LaunchpadClient(launchpadConfiguration!).createProtectedToken(
                {
                  launchpadId: BigInt(launchpadId),
                  ...launchRequest,
                  creator: getAddress(address),
                  policyId: BigInt(protectionPolicyId),
                  deadline: BigInt(Math.floor(Date.now() / 1_000) + 900),
                  referralRecipient: zeroAddress,
                },
              )
            : new ProtectedLaunchClient(
                deployment.protectedLaunch!,
              ).createProtectedLaunch({
                ...launchRequest,
                policyId: BigInt(protectionPolicyId),
                deadline: BigInt(Math.floor(Date.now() / 1_000) + 900),
              })
          : launchpadId
            ? new LaunchpadClient(launchpadConfiguration!).createToken({
                launchpadId: BigInt(launchpadId),
                ...launchRequest,
                referralRecipient: zeroAddress,
              })
            : dbcClient(deployment).createLaunch(launchRequest);
      const createHash = await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [contractCallTransaction(call)],
        action: "Token launch",
        onStatus: setStatus,
      });
      launchCreated = true;
      const receipt = (await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [createHash],
      })) as {
        blockNumber?: string;
        logs?: readonly Readonly<{
          address: string;
          data: `0x${string}`;
          topics: [] | [`0x${string}`, ...`0x${string}`[]];
        }>[];
      } | null;
      const launchFactory =
        launchProtection === "protected"
          ? deployment.protectedLaunch!.launchFactory
          : deployment.launchFactory;
      const eventAbi =
        launchProtection === "protected"
          ? protectedLaunchFactoryAbi
          : dbcEventsAbi;
      const launched = receipt?.logs
        ?.filter(
          (log) => log.address.toLowerCase() === launchFactory.toLowerCase(),
        )
        .map((log) => {
          try {
            return decodeEventLog({
              abi: eventAbi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            return null;
          }
        })
        .find((event) =>
          launchProtection === "protected"
            ? event?.eventName === "ProtectedTokenLaunched"
            : event?.eventName === "TokenLaunched",
        );
      const blockNumber = receipt?.blockNumber
        ? BigInt(receipt.blockNumber).toString()
        : "0";
      const optimisticLaunch: DbcLaunch | undefined =
        launched?.eventName === "TokenLaunched" ||
        launched?.eventName === "ProtectedTokenLaunched"
          ? {
              launch_id: launched.args.launchId,
              template_id: launched.args.templateId.toString(),
              creator: getAddress(address),
              token_address: getAddress(launched.args.token),
              virtual_pool: getAddress(launched.args.virtualPool),
              quote_token: getAddress(launched.args.quoteToken),
              name: name.trim(),
              symbol: symbol.trim().toUpperCase(),
              metadata_uri: metadata.metadataUri,
              metadata_id: metadata.metadataId,
              website_url: websiteUrl || null,
              x_url: xUrl || null,
              has_logo: Boolean(metadata.logoUrl),
              lifecycle: 1,
              real_quote_reserve_raw: "0",
              base_sold_raw: "0",
              graduation_threshold_raw:
                launched.eventName === "TokenLaunched"
                  ? launched.args.graduationThresholdRaw.toString()
                  : (economics?.graduationThresholdRaw ?? null),
              progress_bps: 0,
              created_block: blockNumber,
              updated_block: blockNumber,
              volume_raw: "0",
              trade_count: 0,
              holder_count: 0,
              creator_claimable_raw: "0",
              protocol_claimable_raw: "0",
              launchpad_bound: Boolean(launchpadId),
              launchpad_id: launchpadId ?? null,
            }
          : undefined;
      onClose();
      onComplete(optimisticLaunch);
      window.setTimeout(onComplete, 4_000);
      window.setTimeout(onComplete, 10_000);
      window.setTimeout(onComplete, 20_000);
      window.setTimeout(onComplete, 35_000);
      if (initialBuyRaw > 0n && economics) {
        if (!launched || launched.eventName !== "TokenLaunched")
          throw new Error("INITIAL_BUY_POOL_NOT_FOUND");
        setPendingInitialBuy({
          pool: getAddress(launched.args.virtualPool),
          quoteToken: getAddress(economics.quoteToken),
          recipient: getAddress(walletRecipient),
          amountRaw: initialBuyRaw,
          symbol: symbol.trim().toUpperCase(),
          quoteSymbol,
          quoteDecimals,
          phase: "approve",
        });
        setInitialBuyStatus("");
        toast({
          kind: "success",
          title: "Launch created",
          body: `Continue with the explicit ${quoteSymbol} approval and initial buy steps.`,
        });
        return;
      }
      toast({
        kind: "success",
        title: "Launch created",
        body: "The indexer will publish the new curve market after finality.",
      });
      onComplete();
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
        return;
      }
      setStatus(error instanceof Error ? error.message : "LAUNCH_FAILED");
    } finally {
      setSubmitting(false);
    }
  }
  async function approveInitialBuy() {
    if (!pendingInitialBuy || !address || !config || !window.ethereum) return;
    setInitialBuyBusy(true);
    setInitialBuyStatus(
      `Waiting for ${pendingInitialBuy.quoteSymbol} approval`,
    );
    try {
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [
          approvalTransaction(
            pendingInitialBuy.quoteToken,
            pendingInitialBuy.pool,
            pendingInitialBuy.amountRaw,
          ),
        ],
        action: "Initial buy approval",
        onStatus: setInitialBuyStatus,
      });
      setPendingInitialBuy({ ...pendingInitialBuy, phase: "buy" });
      setInitialBuyStatus(`${pendingInitialBuy.quoteSymbol} approved`);
    } catch (error) {
      setInitialBuyStatus(
        error instanceof Error ? error.message : "APPROVAL_FAILED",
      );
    } finally {
      setInitialBuyBusy(false);
    }
  }
  async function confirmInitialBuy() {
    if (!pendingInitialBuy || !address || !config || !window.ethereum) return;
    setInitialBuyBusy(true);
    setInitialBuyStatus("Refreshing curve quote");
    try {
      const quote = await apiRequest<DbcQuoteResponse>(
        webPublicConfig.apiUrl,
        "/v1/dbc/quote",
        {
          method: "POST",
          body: JSON.stringify({
            pool: pendingInitialBuy.pool,
            side: "buy",
            amountRaw: pendingInitialBuy.amountRaw.toString(),
          }),
        },
      );
      if (!quote.baseOutRaw) throw new Error("INITIAL_BUY_QUOTE_UNAVAILABLE");
      const call = dbcClient(deployment).buyExactInput({
        pool: pendingInitialBuy.pool,
        grossQuoteInRaw: pendingInitialBuy.amountRaw,
        minimumBaseOutRaw: minimumAmountOut(BigInt(quote.baseOutRaw), 100),
        maximumPriceX18: (BigInt(quote.finalPriceX18) * 10_100n) / 10_000n,
        recipient: pendingInitialBuy.recipient,
        deadline: BigInt(Math.floor(Date.now() / 1_000) + 900),
      });
      await executeDbcTransactions({
        provider: window.ethereum,
        account: address,
        chainId: config.chainId,
        calls: [contractCallTransaction(call)],
        action: "Initial curve buy",
        onStatus: setInitialBuyStatus,
      });
      setPendingInitialBuy(null);
      setInitialBuyStatus("");
      toast({
        kind: "success",
        title: "Initial buy confirmed",
        body: `${pendingInitialBuy.symbol} market data will update automatically.`,
      });
      onComplete();
      window.setTimeout(onComplete, 4_000);
      window.setTimeout(onComplete, 10_000);
      window.setTimeout(onComplete, 20_000);
      window.setTimeout(onComplete, 35_000);
    } catch (error) {
      setInitialBuyStatus(
        error instanceof Error ? error.message : "INITIAL_BUY_FAILED",
      );
    } finally {
      setInitialBuyBusy(false);
    }
  }
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={
          launchpadId
            ? `Create token in launchpad ${launchpadId}`
            : "Create a curve launch"
        }
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
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Launch protection"
            >
              <button
                type="button"
                role="radio"
                aria-checked={launchProtection === "standard"}
                disabled={stockQuoteTemplateSelected}
                onClick={() => setLaunchProtection("standard")}
                className={`border p-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${launchProtection === "standard" ? "border-lime bg-white/[.03]" : "border-line"}`}
              >
                <span className="font-mono text-xs uppercase">Standard</span>
                <span className="mt-2 block text-[11px] leading-5 text-muted">
                  Governed curve and graduation rules.
                </span>
                {stockQuoteTemplateSelected && (
                  <span className="mt-2 block text-[10px] text-muted">
                    Tokenized stock quotes use protected execution.
                  </span>
                )}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={launchProtection === "protected"}
                disabled={
                  protectionPolicies.length === 0 ||
                  !deployment.protectedLaunch ||
                  (Boolean(launchpadId) && !launchpadConfiguration)
                }
                onClick={() => setLaunchProtection("protected")}
                className={`border p-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${launchProtection === "protected" ? "border-lime bg-white/[.03]" : "border-line"}`}
              >
                <span className="flex items-center gap-2 font-mono text-xs uppercase">
                  <ShieldCheck className="size-4" /> Protected
                </span>
                <span className="mt-2 block text-[11px] leading-5 text-muted">
                  Buy caps, dynamic launch fee and locked creator LP.
                </span>
              </button>
            </div>
            {launchProtection === "protected" && (
              <div className="panel-inset space-y-3 p-4">
                <label className="block">
                  <span className="label">Protection policy</span>
                  <select
                    value={protectionPolicyId}
                    onChange={(event) =>
                      setProtectionPolicyId(event.target.value)
                    }
                    className="mt-2 w-full border border-line bg-bg px-3 py-3 text-sm outline-none focus:border-lime"
                  >
                    {protectionPolicies.map((policy) => (
                      <option key={policy.policy_id} value={policy.policy_id}>
                        Policy {policy.policy_id} · v{policy.version}
                      </option>
                    ))}
                  </select>
                </label>
                {protectionLoading ? (
                  <div className="h-20 animate-pulse bg-white/[.04]" />
                ) : protectionPreview ? (
                  <ProtectionSummary
                    preview={protectionPreview}
                    decimals={18}
                  />
                ) : null}
              </div>
            )}
            <div>
              <p className="label">Governed template</p>
              <p className="mt-2 text-sm text-muted">
                Templates lock supply, curve, fees, quote asset and the verified
                DAMM or DLMM migration policy before launch.
              </p>
            </div>
            {launchpadId && launchpadPreset && (
              <div className="border border-line p-4 text-xs leading-5 text-muted">
                Launchpad {launchpadId} is bound onchain to Template{" "}
                {launchpadPreset.dbcTemplateId}. Its quote asset and{" "}
                {launchpadPreset.graduationDestination === 1 ? "DLMM" : "DAMM"}{" "}
                destination cannot be changed after deployment.
              </div>
            )}
            {!launchpadId &&
              (stockQuoteCatalogLoading || stockQuoteCatalog.length > 0) && (
                <div className="panel-inset space-y-3 p-4">
                  <div>
                    <p className="label">Tokenized stock quote catalog</p>
                    <p className="mt-2 text-[11px] leading-5 text-muted">
                      Address-verified issuer assets appear here before
                      governance enables a corresponding launch template.
                    </p>
                  </div>
                  {stockQuoteCatalogLoading ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <span className="content-shimmer h-16" aria-hidden />
                      <span className="content-shimmer h-16" aria-hidden />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="flex h-11 items-center gap-2 border border-line bg-bg px-3 focus-within:border-lime/60">
                        <Search className="size-4 text-muted" aria-hidden />
                        <input
                          value={stockCatalogQuery}
                          onChange={(event) =>
                            setStockCatalogQuery(event.target.value)
                          }
                          placeholder="Search symbol, issuer or contract"
                          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                          aria-label="Search tokenized stock quote assets"
                        />
                      </label>
                      <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {filteredStockQuoteCatalog.map((asset) => (
                          <button
                            type="button"
                            key={asset.contractAddress}
                            aria-pressed={
                              catalogStockAddress === asset.contractAddress
                            }
                            onClick={() => {
                              setCatalogStockAddress(asset.contractAddress);
                              setLaunchProtection("protected");
                              setInitialBuy("");
                              setStatus("");
                              const matchingTemplates =
                                stockTemplateIds[
                                  asset.contractAddress.toLowerCase()
                                ];
                              const matchingTemplate =
                                matchingTemplates?.dlmm ??
                                matchingTemplates?.damm;
                              if (matchingTemplate)
                                setTemplateId(matchingTemplate);
                            }}
                            className={`border bg-bg p-3 text-left ${catalogStockAddress === asset.contractAddress ? "border-lime/70" : "border-line"}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-xs text-fg">
                                  {asset.instrumentName}
                                </p>
                                <p className="mt-1 font-mono text-[10px] text-muted">
                                  {asset.symbol} ·{" "}
                                  {asset.marketState.replaceAll("_", " ")}
                                </p>
                              </div>
                              <span className="border border-line px-2 py-1 font-mono text-[9px] uppercase text-muted">
                                {asset.availability}
                              </span>
                            </div>
                            <p className="mt-3 break-all font-mono text-[9px] text-muted">
                              {asset.contractAddress}
                            </p>
                            <p className="mt-2 text-[10px] text-muted">
                              {Object.keys(
                                stockTemplateIds[
                                  asset.contractAddress.toLowerCase()
                                ] ?? {},
                              ).length > 0
                                ? asset.quoteTradingEnabled
                                  ? "Protected launch template active"
                                  : "Template ready · trading disabled"
                                : "Cataloged · launch template unavailable"}
                            </p>
                          </button>
                        ))}
                      </div>
                      {filteredStockQuoteCatalog.length === 0 && (
                        <p className="border border-line p-3 text-[11px] text-muted">
                          No address-verified stock quote asset matches this
                          search.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            {templates
              .filter(
                (item) =>
                  item.enabled &&
                  (!launchpadPreset ||
                    item.template_id === launchpadPreset.dbcTemplateId),
              )
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
                    value={`${formatTokenAmount(BigInt(economics.graduationThresholdRaw), quoteDecimals)} ${quoteSymbol}`}
                  />
                  <Review
                    label="Trade fee"
                    value={`${economics.tradeFeeBps / 100}%`}
                  />
                  <Review
                    label={`${economics.migrationMode === 1 ? "DLMM" : "DAMM"} fee`}
                    value={`${economics.destinationFeePips / 10_000}%`}
                  />
                  <Review
                    label="Creator LP"
                    value={`${economics.creatorLpShareBps / 100}%`}
                  />
                </div>
              )
            )}
            {displayedStockAsset &&
              catalogStockDestinationsLoading &&
              !stockQuoteAsset && (
                <div
                  className="panel-inset grid gap-3 p-4 sm:grid-cols-2"
                  aria-label="Loading stock quote policy"
                >
                  <span className="content-shimmer h-20" aria-hidden />
                  <span className="content-shimmer h-20" aria-hidden />
                </div>
              )}
            {displayedStockAsset &&
              (!catalogStockDestinationsLoading || stockQuoteAsset) && (
                <StockQuoteAssetSummary
                  key={`${displayedStockAsset.contractAddress}-${selectedMigrationMode}`}
                  asset={displayedStockAsset}
                  destinations={displayedStockDestinations}
                  selectedMigrationMode={selectedMigrationMode}
                  availableMigrationModes={
                    new Set(
                      Object.keys(
                        stockTemplateIds[
                          displayedStockAsset.contractAddress.toLowerCase()
                        ] ?? {},
                      ) as ("damm" | "dlmm")[],
                    )
                  }
                  onSelectMigrationMode={(mode) => {
                    const matchingTemplate =
                      stockTemplateIds[
                        displayedStockAsset.contractAddress.toLowerCase()
                      ]?.[mode];
                    if (matchingTemplate) setTemplateId(matchingTemplate);
                  }}
                />
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
                          error instanceof Error
                            ? error.message
                            : "LOGO_FAILED",
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
                label={`Initial buy · optional (${quoteSymbol})`}
                value={initialBuy}
                onChange={
                  launchProtection === "protected"
                    ? () => undefined
                    : setInitialBuy
                }
                placeholder="0.01"
              />
              <p className="mt-2 text-[11px] leading-5 text-muted">
                {launchProtection === "protected"
                  ? "Create the protected market first, then buy within its verified per-transaction and per-address limits."
                  : `After launch creation, your wallet approves ${quoteSymbol} and performs the first curve buy. Leave empty to create without buying.`}
              </p>
              {!validInitialBuy && (
                <p className="mt-1 text-xs text-danger">
                  Enter a valid {quoteSymbol} amount within the graduation
                  threshold.
                </p>
              )}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <div className="panel-inset grid gap-px bg-line sm:grid-cols-2">
              <Review
                label="Token"
                value={`${name} / ${symbol.toUpperCase()}`}
              />
              <Review
                label="Template"
                value={`#${templateId} · v${selected?.version ?? "—"} · ${selectedMigrationMode.toUpperCase()}`}
              />
              <Review
                label="Launch protection"
                value={
                  launchProtection === "protected"
                    ? `Protected · policy ${protectionPolicyId}`
                    : "Standard"
                }
              />
              {protectionPreview && (
                <Review
                  label="Verified policy"
                  value={`v${protectionPreview.policyVersion} · ${protectionPreview.policyHash}`}
                />
              )}
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
                    ? `Trade ${economics.tradeFeeBps / 100}% · ${selectedMigrationMode.toUpperCase()} ${economics.destinationFeePips / 10_000}%`
                    : "Unavailable"
                }
              />
              <Review
                label="Graduation"
                value={
                  economics
                    ? `${formatTokenAmount(BigInt(economics.graduationThresholdRaw), quoteDecimals)} ${quoteSymbol} · ±${economics.terminalPriceToleranceBps / 100}%`
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
                value={
                  initialBuyRaw > 0n ? `${initialBuy} ${quoteSymbol}` : "None"
                }
              />
            </div>
            <p className="text-xs leading-5 text-muted">
              Your wallet creates the token and virtual pool atomically. If an
              initial buy is set, approval and buy follow as separate wallet
              confirmations so every onchain action remains visible.
            </p>
            <button
              disabled={
                !economics ||
                (stockQuoteTemplateSelected &&
                  launchProtection !== "protected") ||
                (launchProtection === "protected" &&
                  (!deployment.protectedLaunch || !protectionPreview)) ||
                submitting
              }
              onClick={() => void submit()}
              className="flex w-full items-center justify-center gap-2 bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-50"
            >
              <Rocket className="size-4" />
              {submitting
                ? status || "Preparing wallet"
                : launchProtection === "protected"
                  ? "Create protected launch"
                  : "Create launch"}
            </button>
            {!submitting && status && status !== "confirmed" && (
              <p
                role="alert"
                className="break-words text-xs leading-5 text-red-300"
              >
                The launch was not submitted. Review the details and try again.
              </p>
            )}
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
              {submitting ? "Wallet action in progress" : "Ready for wallet"}
            </span>
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(pendingInitialBuy)}
        onClose={() => {
          if (!initialBuyBusy) setPendingInitialBuy(null);
        }}
        title="Complete initial buy"
        width="max-w-lg"
      >
        {pendingInitialBuy && (
          <div className="space-y-5">
            <div className="border border-line bg-white/[.02] p-4">
              <p className="text-sm text-fg">Your launch is already onchain.</p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Complete the optional{" "}
                {formatTokenAmount(
                  pendingInitialBuy.amountRaw,
                  pendingInitialBuy.quoteDecimals,
                )}{" "}
                {pendingInitialBuy.quoteSymbol} initial buy using two explicit
                wallet confirmations.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div
                className={`border p-3 font-mono text-[10px] uppercase ${pendingInitialBuy.phase === "approve" ? "border-lime text-fg" : "border-line text-muted"}`}
              >
                1. Approve {pendingInitialBuy.quoteSymbol}
              </div>
              <div
                className={`border p-3 font-mono text-[10px] uppercase ${pendingInitialBuy.phase === "buy" ? "border-lime text-fg" : "border-line text-muted"}`}
              >
                2. Confirm buy
              </div>
            </div>
            {initialBuyStatus && (
              <p className="text-xs text-muted">{initialBuyStatus}</p>
            )}
            <button
              disabled={initialBuyBusy}
              onClick={() =>
                void (pendingInitialBuy.phase === "approve"
                  ? approveInitialBuy()
                  : confirmInitialBuy())
              }
              className="w-full bg-lime py-3 font-mono text-xs uppercase text-lime-ink disabled:opacity-50"
            >
              {initialBuyBusy
                ? initialBuyStatus || "Waiting for wallet"
                : pendingInitialBuy.phase === "approve"
                  ? `Approve ${pendingInitialBuy.quoteSymbol}`
                  : "Confirm initial buy"}
            </button>
            <button
              disabled={initialBuyBusy}
              onClick={() => setPendingInitialBuy(null)}
              className="w-full border border-line py-3 font-mono text-xs uppercase text-muted hover:text-fg disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        )}
      </Modal>
    </>
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

function ProtectionSummary({
  preview,
  decimals,
}: Readonly<{
  preview: ProtectedLaunchPreview;
  decimals: number;
}>) {
  const lockDays = Math.ceil(Number(BigInt(preview.lpLockSeconds)) / 86_400);
  return (
    <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
      <Review
        label="Per transaction"
        value={formatTokenAmount(
          BigInt(preview.maximumPerTransactionRaw),
          decimals,
        )}
      />
      <Review
        label="Per address"
        value={formatTokenAmount(
          BigInt(preview.maximumPerAddressRaw),
          decimals,
        )}
      />
      <Review
        label="Protection window"
        value={`${preview.protectionStartBlock}–${preview.protectionEndBlock}`}
      />
      <Review
        label="Launch fee"
        value={`${preview.initialFeeBps / 100}% → ${preview.baseFeeBps / 100}%`}
      />
      <Review label="Creator LP lock" value={`${lockDays} days`} />
      <Review label="Chain" value={String(preview.chainId)} />
    </div>
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
