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
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import { shortHex } from "@/lib/format";
import { LaunchActions } from "./LaunchActions";
import { LaunchChart } from "./LaunchChart";
import { LaunchWizard } from "./LaunchWizard";
import { LaunchpadBuilder } from "./LaunchpadBuilder";
import { LaunchpadOwnerDashboard } from "./LaunchpadOwnerDashboard";
import type { PendingLaunchpad } from "./LaunchpadOwnerDashboard";
import { LaunchTradeHistory } from "./LaunchTradeHistory";
import type { DbcLaunch, DbcTemplate } from "./types";
import { useApp } from "@/components/shell/AppProvider";

const lifecycle = ["Draft", "Active", "Paused", "Ready", "Graduated"] as const;
const logoUrl = (launch: DbcLaunch) =>
  launch.has_logo && launch.metadata_id
    ? `/api/v1/dbc/metadata/${launch.metadata_id}/logo`
    : `/asset-logo/${launch.symbol ?? ""}`;

export function Launchpad() {
  const { config } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const launchpadFilter = searchParams.get("launchpad");
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
  const [wizard, setWizard] = useState(false);
  const [wizardLaunchpadId, setWizardLaunchpadId] = useState<string | null>(
    null,
  );
  const [pendingLaunchpads, setPendingLaunchpads] = useState<
    readonly PendingLaunchpad[]
  >([]);
  const liveRefreshTimers = useRef<number[]>([]);
  const loadedOnce = useRef(false);
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
  const refreshRealtime = useCallback(() => {
    liveRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    liveRefreshTimers.current = [];
    for (let delay = 0; delay <= 36_000; delay += 2_000) {
      liveRefreshTimers.current.push(window.setTimeout(refresh, delay));
    }
  }, [refresh]);
  useEffect(
    () => () =>
      liveRefreshTimers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
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
    setTemplates([]);
    setLaunches([]);
    setPendingLaunches([]);
    setPendingLaunchpads([]);
    setDeployment(null);
    setSelectedId("");
    if (!loadedOnce.current) setLoading(true);
    setError("");
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
  }, [config?.chainId, revision]);

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
      {view === "build" ? (
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
                          {item.symbol ?? shortHex(item.token_address)}/USDG
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
                <LaunchChart
                  launchId={selected.launch_id}
                  symbol={selected.symbol ?? "TOKEN"}
                  refreshKey={selected.updated_block}
                />
                <div className="grid border-t border-line sm:grid-cols-5">
                  <Metric
                    label="Curve reserve"
                    value={`${formatTokenAmount(BigInt(selected.real_quote_reserve_raw), 6)} USDG`}
                  />
                  <Metric
                    label="Recorded volume"
                    value={`${formatTokenAmount(BigInt(selected.volume_raw ?? "0"), 6)} USDG`}
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
                  <p className="text-sm text-muted">No indexed launches.</p>
                )}
              </div>
            )}
          </section>
          {selected && deployment ? (
            <LaunchActions
              launch={selected}
              deployment={deployment}
              onComplete={refreshRealtime}
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
