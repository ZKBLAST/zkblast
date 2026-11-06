"use client";
import {
  ArrowUpDown,
  AtSign,
  Globe,
  LayoutDashboard,
  Rocket,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTokenAmount, type DbcAddresses } from "@zkblast/sdk";
import { AssetLogo } from "@/components/markets/AssetLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiProxyAssetPath, apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { shortHex } from "@/lib/format";
import { assetLogoUrl } from "@/lib/asset-logo-url";
import { useLaunchpadEventRefresh } from "@/lib/use-launchpad-event-refresh";
import { LaunchActions } from "./LaunchActions";
import { LaunchChart } from "./LaunchChart";
import { LaunchWizard } from "./LaunchWizard";
import { LaunchpadBuilder } from "./LaunchpadBuilder";
import { LaunchpadOwnerDashboard } from "./LaunchpadOwnerDashboard";
import type { PendingLaunchpad } from "./LaunchpadOwnerDashboard";
import { LaunchTradeHistory } from "./LaunchTradeHistory";
import type {
  DbcLaunch,
  DbcTemplate,
  ProtectedLaunchIdentity,
  ProtectedLaunchSecurity,
  TemplateEconomics,
} from "./types";
import { getTemplateEconomics } from "@/lib/template-economics";
import { useApp } from "@/components/shell/AppProvider";

const lifecycle = ["Draft", "Active", "Paused", "Ready", "Graduated"] as const;
const logoUrl = (launch: DbcLaunch) =>
  launch.has_logo && launch.metadata_id
    ? apiProxyAssetPath(`/v1/dbc/metadata/${launch.metadata_id}/logo`)
    : assetLogoUrl(launch.symbol ?? "");

export function Launchpad() {
  const { config } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const launchpadFilter = searchParams.get("launchpad");
  const createTokenRequested =
    searchParams.get("action") === "create-token" && Boolean(launchpadFilter);
  const view =
    requestedView === "build" || requestedView === "manage"
      ? requestedView
      : "markets";
  const [templates, setTemplates] = useState<readonly DbcTemplate[]>([]);
  const [launches, setLaunches] = useState<readonly DbcLaunch[]>([]);
  const [pendingLaunches, setPendingLaunches] = useState<readonly DbcLaunch[]>(
    [],
  );
  const [deployment, setDeployment] = useState<DbcAddresses | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "progress" | "volume">("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [wizard, setWizard] = useState(createTokenRequested);
  const [wizardLaunchpadId, setWizardLaunchpadId] = useState<string | null>(
    createTokenRequested ? launchpadFilter : null,
  );
  const [pendingLaunchpads, setPendingLaunchpads] = useState<
    readonly PendingLaunchpad[]
  >([]);
  const loadedOnce = useRef(false);
  const loadedChainId = useRef<number | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const retryPendingLaunchpad = useCallback(
    async (item: PendingLaunchpad) => {
      let reconciliation: PendingLaunchpad["reconciliation"] = "failed";
      try {
        await apiRequest(
          webPublicConfig.apiUrl,
          `/v1/launchpads/records/${item.launchpadId}`,
          { cache: "no-store" },
        );
        reconciliation = "onchain";
        try {
          await apiRequest(
            webPublicConfig.apiUrl,
            `/v1/launchpads/${encodeURIComponent(item.slug)}`,
            { cache: "no-store" },
          );
          reconciliation = "published";
        } catch {
          // The onchain launchpad can exist before signed branding is published.
        }
      } catch {
        reconciliation = "failed";
      }
      setPendingLaunchpads((current) =>
        current.map((existing) =>
          existing.launchpadId === item.launchpadId
            ? { ...existing, reconciliation }
            : existing,
        ),
      );
      refresh();
    },
    [refresh],
  );
  const launchExecutionEnabled = Boolean(
    config?.capabilities.launchpad && config.capabilities.dbc,
  );
  useLaunchpadEventRefresh(
    refresh,
    launchExecutionEnabled ? config?.chainId : null,
  );
  const completeLaunch = useCallback(
    (launch?: DbcLaunch) => {
      if (launch) {
        setPendingLaunches((current) => [
          launch,
          ...current.filter((item) => item.launch_id !== launch.launch_id),
        ]);
        setSelectedId(launch.launch_id);
      }
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const controller = new AbortController();
    const chainId = config?.chainId ?? null;
    const chainChanged = loadedChainId.current !== chainId;
    if (chainChanged) {
      loadedChainId.current = chainId;
      setTemplates([]);
      setLaunches([]);
      setPendingLaunches([]);
      setPendingLaunchpads([]);
      setDeployment(null);
      setSelectedId("");
      setLoading(true);
    } else if (!loadedOnce.current) setLoading(true);
    setError("");
    if (config && !launchExecutionEnabled) {
      loadedOnce.current = true;
      setLoading(false);
      return () => controller.abort();
    }
    void Promise.all([
      apiRequest<{ items: DbcTemplate[] }>(
        webPublicConfig.apiUrl,
        "/v1/dbc/templates?limit=100",
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<{ items: DbcLaunch[] }>(
        webPublicConfig.apiUrl,
        "/v1/dbc/launches?limit=100",
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<DbcAddresses>(webPublicConfig.apiUrl, "/v1/dbc/deployment", {
        signal: controller.signal,
        cache: "no-store",
      }),
    ])
      .then(([templateResult, launchResult, deploymentResult]) => {
        setTemplates(templateResult.items);
        setLaunches(launchResult.items);
        const indexedIds = new Set(
          launchResult.items.map((item) => item.launch_id),
        );
        setPendingLaunches((current) =>
          current.filter((item) => !indexedIds.has(item.launch_id)),
        );
        setDeployment(deploymentResult);
        setSelectedId(
          (current) => current || launchResult.items[0]?.launch_id || "",
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "DBC_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          loadedOnce.current = true;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [config, launchExecutionEnabled, revision]);

  const allLaunches = useMemo(
    () => [
      ...pendingLaunches.filter(
        (pending) =>
          !launches.some((item) => item.launch_id === pending.launch_id),
      ),
      ...launches,
    ],
    [launches, pendingLaunches],
  );
  const visible = useMemo(
    () =>
      allLaunches
        .filter(
          (item) => !launchpadFilter || item.launchpad_id === launchpadFilter,
        )
        .filter((item) =>
          `${item.name ?? ""} ${item.symbol ?? ""} ${item.token_address}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "progress"
            ? b.progress_bps - a.progress_bps
            : sort === "volume"
              ? Number(
                  BigInt(b.volume_raw ?? "0") - BigInt(a.volume_raw ?? "0"),
                )
              : Number(BigInt(b.updated_block) - BigInt(a.updated_block)),
        ),
    [allLaunches, launchpadFilter, search, sort],
  );
  const selected =
    visible.find((item) => item.launch_id === selectedId) ?? visible[0] ?? null;
  const [selectedEconomics, setSelectedEconomics] =
    useState<TemplateEconomics | null>(null);
  const [selectedSecurity, setSelectedSecurity] =
    useState<ProtectedLaunchSecurity | null>(null);
  const [selectedIdentity, setSelectedIdentity] =
    useState<ProtectedLaunchIdentity | null>(null);
  const economicsTemplateId =
    selected?.template_id ?? templates[0]?.template_id ?? null;
  useEffect(() => {
    if (!economicsTemplateId) {
      setSelectedEconomics(null);
      return;
    }
    let cancelled = false;
    void getTemplateEconomics(economicsTemplateId)
      .then((value) => {
        if (!cancelled) setSelectedEconomics(value);
      })
      .catch(() => {
        if (!cancelled) setSelectedEconomics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [config?.chainId, economicsTemplateId]);
  useEffect(() => {
    if (!selected?.launch_id) {
      setSelectedSecurity(null);
      setSelectedIdentity(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      apiRequest<ProtectedLaunchSecurity>(
        webPublicConfig.apiUrl,
        `/v1/dbc/launches/${selected.launch_id}/security`,
        { signal: controller.signal, cache: "no-store" },
      ).catch(() => null),
      apiRequest<ProtectedLaunchIdentity>(
        webPublicConfig.apiUrl,
        `/v1/dbc/launches/${selected.launch_id}/identity`,
        { signal: controller.signal, cache: "no-store" },
      ).catch(() => null),
    ]).then(([security, identity]) => {
      if (!controller.signal.aborted) {
        setSelectedSecurity(security);
        setSelectedIdentity(identity);
      }
    });
    return () => controller.abort();
  }, [config?.chainId, selected?.launch_id, selected?.updated_block]);
  const selectedQuoteSymbol = selectedEconomics?.quoteSymbol ?? "QUOTE";
  const selectedQuoteDecimals = selectedEconomics?.quoteDecimals ?? 18;

  const selectView = useCallback(
    (next: "markets" | "build" | "manage") => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "markets") params.delete("view");
      else params.set("view", next);
      router.replace(params.size ? `/launch?${params.toString()}` : "/launch", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  return (
    <main
      id="main"
      className="mx-auto min-h-screen max-w-[1480px] px-3 pb-14 pt-[calc(var(--header-h)+1rem)] sm:px-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 py-4">
        <div>
          <p className="label">ZKBLAST launch infrastructure</p>
          <h1 className="mt-2 text-2xl tracking-wide sm:text-3xl">
            {view === "markets"
              ? "Launch markets"
              : view === "build"
                ? "Build launchpad"
                : "My launchpads"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {view === "markets"
              ? "Create and trade governed curve markets, then follow their liquidity into ZKBLAST DAMM."
              : view === "build"
                ? "Configure identity, ownership, branding, economics and domain in one guided flow."
                : "Monitor the launchpads and curve products controlled by the connected wallet."}
          </p>
        </div>
        {config && (
          <div className="border border-line bg-raised/50 px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted">
            <span className="text-fg">{config.chainName}</span>
            <span className="mx-2">·</span>
            <span>chain {config.chainId}</span>
          </div>
        )}
      </div>
      <nav
        aria-label="Launch workspace"
        className="mb-4 grid divide-y divide-line overflow-hidden border border-line bg-raised/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        {(
          [
            ["markets", "Markets", Store],
            ["build", "Build launchpad", Rocket],
            ["manage", "My launchpads", LayoutDashboard],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => selectView(value)}
            aria-current={view === value ? "page" : undefined}
            className={`relative flex min-h-14 items-center justify-center gap-2 border-b-2 px-4 font-mono text-xs uppercase tracking-wide transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime ${view === value ? "border-lime bg-white/[.05] text-fg shadow-[inset_0_-8px_16px_-16px_rgba(223,227,238,0.95)]" : "border-transparent text-muted hover:bg-white/[.04] hover:text-fg"}`}
          >
            <Icon
              className={`size-4 ${view === value ? "stroke-[2.4]" : ""}`}
              aria-hidden
            />
            {label}
          </button>
        ))}
      </nav>
      {config && !launchExecutionEnabled ? (
        <section className="panel ticks grid min-h-[28rem] place-items-center p-6 text-center">
          <div className="max-w-xl">
            <span className="mx-auto grid size-12 place-items-center border border-line bg-raised/70">
              <ShieldCheck className="size-5 text-lime" aria-hidden />
            </span>
            <p className="label mt-5">{config.chainName}</p>
            <h2 className="mt-2 text-xl">Launch execution is disabled</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              The network is connected and isolated. Launch creation, curve
              trading and claims become available only after the deployed
              contracts and canonical indexer receipts are installed for chain {" "}
              {config.chainId}.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 font-mono text-[10px] uppercase text-muted">
              <span className="border border-line px-3 py-2">Wallet network ready</span>
              <span className="border border-line px-3 py-2">Data isolation ready</span>
              <span className="border border-line px-3 py-2">Execution locked</span>
            </div>
          </div>
        </section>
      ) : view === "build" ? (
        <LaunchpadBuilder
          onOpenMarkets={() => selectView("markets")}
          onOpenManage={() => selectView("manage")}
          onCreated={(item) =>
            setPendingLaunchpads((current) => [
              item,
              ...current.filter(
                (existing) => existing.launchpadId !== item.launchpadId,
              ),
            ])
          }
        />
      ) : view === "manage" ? (
        <LaunchpadOwnerDashboard
          launches={allLaunches}
          pendingLaunchpads={pendingLaunchpads}
          loading={loading}
          onBuild={() => selectView("build")}
          onCreateToken={(launchpadId) => {
            setWizardLaunchpadId(launchpadId);
            setWizard(true);
          }}
          onRefresh={refresh}
          onRetryPending={(item) => void retryPendingLaunchpad(item)}
          quoteSymbol={selectedQuoteSymbol}
          quoteDecimals={selectedQuoteDecimals}
        />
      ) : error && !loading ? (
        <div className="panel ticks p-6">
          <p className="text-danger">Launchpad data unavailable · {error}</p>
          <button
            onClick={refresh}
            className="mt-4 border border-line px-4 py-2 text-xs"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="panel ticks grid min-h-[46rem] overflow-hidden xl:grid-cols-[18rem_minmax(0,1fr)_23rem]">
          <aside className="min-w-0 border-b border-line xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="label">
                {launchpadFilter
                  ? `Launchpad ${launchpadFilter}`
                  : "Curve markets"}
              </span>
              <span className="font-mono text-[10px] text-muted">
                {visible.length}
              </span>
            </div>
            {launchpadFilter && (
              <button
                onClick={() => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.delete("launchpad");
                  router.replace(
                    params.size ? `/launch?${params.toString()}` : "/launch",
                    { scroll: false },
                  );
                }}
                className="mx-3 mt-3 border border-line px-3 py-2 font-mono text-[10px] uppercase text-muted hover:text-fg"
              >
                Show all markets
              </button>
            )}
            <div className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] xl:grid-cols-1">
              <label className="flex h-11 items-center gap-2 border border-line bg-bg px-3 focus-within:border-lime/60">
                <Search className="size-4 text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search launches"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <label className="flex h-11 items-center gap-2 border border-line bg-bg px-3">
                <ArrowUpDown className="size-4 text-muted" />
                <select
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as typeof sort)
                  }
                  className="w-full bg-transparent text-xs outline-none"
                >
                  <option value="recent">Recent</option>
                  <option value="progress">Progress</option>
                  <option value="volume">Volume</option>
                </select>
              </label>
            </div>
            <div
              className="max-h-[30rem] overflow-y-auto px-2 pb-3 xl:max-h-[38rem]"
              data-lenis-prevent
            >
              {loading
                ? Array.from({ length: 7 }, (_, index) => (
                    <Skeleton key={index} className="mb-2 h-20" />
                  ))
                : visible.length === 0
                  ? (
                    <p className="p-4 text-xs leading-5 text-muted">
                      No token launches on {config?.chainName ?? "this network"}.
                      Launches created on another network remain available when
                      that network is selected.
                    </p>
                  )
                  : visible.map((item) => (
                    <button
                      key={item.launch_id}
                      onClick={() => setSelectedId(item.launch_id)}
                      className={`mb-1 flex w-full items-center gap-3 border p-3 text-left ${selected?.launch_id === item.launch_id ? "border-lime bg-white/[.04]" : "border-transparent hover:border-line"}`}
                    >
                      <AssetLogo
                        url={logoUrl(item)}
                        label={item.symbol ?? "Launch token"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">
                          {item.symbol ?? shortHex(item.token_address)}/{selectedQuoteSymbol}
                        </span>
                        <span className="mt-1 block text-[10px] text-muted">
                          {lifecycle[item.lifecycle]} ·{" "}
                          {(item.progress_bps / 100).toFixed(1)}%
                        </span>
                        <span className="mt-2 block h-1 bg-raised">
                          <span
                            className="block h-full bg-lime"
                            style={{
                              width: `${Math.min(100, item.progress_bps / 100)}%`,
                            }}
                          />
                        </span>
                      </span>
                    </button>
                  ))}
            </div>
          </aside>
          <section className="min-w-0 border-b border-line xl:border-b-0">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <AssetLogo
                      url={logoUrl(selected)}
                      label={selected.symbol ?? "Token"}
                    />
                    <div className="min-w-0">
                      <h2 className="truncate font-mono text-lg">
                        {selected.name ?? selected.symbol ?? "Launch"}
                      </h2>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {shortHex(selected.token_address)} · Template{" "}
                        {selected.template_id}
                      </p>
                      <div className="mt-2 flex gap-3">
                        {selected.website_url && (
                          <a
                            href={selected.website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[10px] text-muted hover:text-fg"
                          >
                            <Globe className="size-3" />
                            Website
                          </a>
                        )}
                        {selected.x_url && (
                          <a
                            href={selected.x_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[10px] text-muted hover:text-fg"
                          >
                            <AtSign className="size-3" />X
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="flex items-center gap-2 border border-line px-3 py-2 font-mono text-[10px] uppercase">
                    <ShieldCheck className="size-3.5 text-lime" />
                    {lifecycle[selected.lifecycle]}
                  </span>
                </div>
                {selectedSecurity && (
                  <ProtectedSecurityPanel
                    security={selectedSecurity}
                    identity={selectedIdentity}
                  />
                )}
                <LaunchChart
                  launchId={selected.launch_id}
                  symbol={selected.symbol ?? "TOKEN"}
                  quoteSymbol={selectedQuoteSymbol}
                  quoteDecimals={selectedQuoteDecimals}
                  refreshKey={selected.updated_block}
                />
                <div className="grid border-t border-line sm:grid-cols-5">
                  <Metric
                    label="Curve reserve"
                    value={`${formatTokenAmount(BigInt(selected.real_quote_reserve_raw), selectedQuoteDecimals)} ${selectedQuoteSymbol}`}
                  />
                  <Metric
                    label="Recorded volume"
                    value={`${formatTokenAmount(BigInt(selected.volume_raw ?? "0"), selectedQuoteDecimals)} ${selectedQuoteSymbol}`}
                  />
                  <Metric
                    label="Trades"
                    value={String(selected.trade_count ?? 0)}
                  />
                  <Metric
                    label="Holders"
                    value={String(selected.holder_count ?? 0)}
                  />
                  <Metric
                    label="Curve sold"
                    value={`${formatTokenAmount(BigInt(selected.base_sold_raw), 18)} ${selected.symbol ?? "TOKEN"}`}
                  />
                </div>
                <LaunchTradeHistory
                  launchId={selected.launch_id}
                  symbol={selected.symbol ?? "TOKEN"}
                  quoteSymbol={selectedQuoteSymbol}
                  quoteDecimals={selectedQuoteDecimals}
                  refreshKey={selected.updated_block}
                />
              </>
            ) : (
              <div className="grid min-h-[36rem] place-items-center p-6">
                {loading ? (
                  <Skeleton className="h-44 w-full max-w-md" />
                ) : launchpadFilter ? (
                  <div className="max-w-md text-center">
                    <span className="mx-auto grid size-12 place-items-center border border-line bg-raised/70">
                      <Rocket className="size-5 text-lime" aria-hidden />
                    </span>
                    <p className="label mt-5">Launchpad {launchpadFilter}</p>
                    <h2 className="mt-2 text-xl">No tokens launched yet</h2>
                    <p className="mt-3 text-sm leading-6 text-muted">
                      This launchpad is ready. Create its first token to open a
                      governed curve market.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setWizardLaunchpadId(launchpadFilter);
                        setWizard(true);
                      }}
                      className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 border border-fg bg-fg px-5 font-mono text-xs uppercase tracking-wide text-bg transition-opacity hover:opacity-90"
                    >
                      <Rocket className="size-4" aria-hidden />
                      Create first token
                    </button>
                  </div>
                ) : (
                  <div className="max-w-md text-center">
                    <p className="text-sm text-muted">
                      No token launches exist on {config?.chainName ?? "this network"}.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-faint">
                      Launchpads and tokens are isolated per chain. Use the
                      network selector to view launches created elsewhere.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
          {selected && deployment ? (
            <LaunchActions
              launch={selected}
              deployment={deployment}
              security={selectedSecurity}
              onComplete={refresh}
            />
          ) : (
            <aside className="border-l border-line p-5">
              {loading ? (
                <Skeleton className="h-96" />
              ) : (
                <p className="text-sm leading-6 text-muted">
                  {launchpadFilter
                    ? "Create the first token to enable curve trading, graduation and claims for this launchpad."
                    : "Select an indexed launch."}
                </p>
              )}
            </aside>
          )}
        </div>
      )}
      {deployment && (
        <LaunchWizard
          open={wizard}
          onClose={() => {
            setWizard(false);
            setWizardLaunchpadId(null);
          }}
          templates={templates}
          deployment={deployment}
          launchpadId={wizardLaunchpadId ?? undefined}
          onComplete={completeLaunch}
        />
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="label">{label}</p>
      <p className="mt-2 break-all font-mono text-sm">{value}</p>
    </div>
  );
}

function ProtectedSecurityPanel({
  security,
  identity,
}: Readonly<{
  security: ProtectedLaunchSecurity;
  identity: ProtectedLaunchIdentity | null;
}>) {
  const unlock = security.creator_unlock_at
    ? new Date(security.creator_unlock_at).toLocaleString()
    : `${Math.ceil(Number(BigInt(security.lp_lock_seconds)) / 86_400)} day lock`;
  const duplicate = Boolean(identity?.duplicate_name || identity?.duplicate_symbol);
  return (
    <section className="border-b border-line bg-white/[.015] p-4 sm:p-5" aria-label="Protected launch security">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-mono text-xs uppercase">
          <ShieldCheck className="size-4 text-lime" /> Verified protected launch
        </span>
        <span className="font-mono text-[10px] text-muted">
          Policy {security.policy_id} · v{security.policy_version} · chain {security.chain_id}
        </span>
      </div>
      <div className="mt-4 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Per transaction" value={`${security.max_buy_bps_per_transaction / 100}% inventory`} />
        <Metric label="Per address" value={`${security.max_buy_bps_per_address / 100}% inventory`} />
        <Metric label="Dynamic fee" value={`${security.initial_fee_bps / 100}% → ${security.base_fee_bps / 100}%`} />
        <Metric label="Creator LP unlock" value={unlock} />
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-muted sm:grid-cols-2">
        <p className="break-all">Policy hash · {security.policy_hash}</p>
        <p className="break-all">
          {identity
            ? `Template v${identity.token_template_version} · runtime ${identity.token_runtime_code_hash}`
            : "Canonical identity is indexed with the launch transaction."}
        </p>
      </div>
      {duplicate && (
        <p className="mt-3 border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          This launch reuses an existing {identity?.duplicate_name ? "name" : "symbol"}. Verify the token contract before trading.
        </p>
      )}
    </section>
  );
}
