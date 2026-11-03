"use client";

import type { DbcAddresses } from "@zkblast/sdk";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetLogo } from "@/components/markets/AssetLogo";
import { LaunchActions } from "@/components/launchpad/LaunchActions";
import { LaunchChart } from "@/components/launchpad/LaunchChart";
import { LaunchTradeHistory } from "@/components/launchpad/LaunchTradeHistory";
import type {
  DbcLaunch,
  TemplateEconomics,
} from "@/components/launchpad/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { webPublicConfig } from "@/config/public-env";
import {
  activeChainId,
  apiProxyAssetPath,
  apiRequest,
} from "@/lib/api-client";
import { shortHex } from "@/lib/format";

type Branding = Readonly<{
  launchpadId: string;
  slug: string;
  name: string;
  description: string;
  primaryColor: string;
  backgroundColor: string;
  foregroundColor: string;
  websiteUrl: string | null;
  xUrl: string | null;
  logoUrl: string | null;
  protocol: "ZKBLAST";
}>;
type NetworkIdentity = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
}>;
const lifecycle = ["Draft", "Active", "Paused", "Ready", "Graduated"] as const;
const tokenLogoUrl = (launch: DbcLaunch) =>
  launch.has_logo && launch.metadata_id
    ? apiProxyAssetPath(`/v1/dbc/metadata/${launch.metadata_id}/logo`)
    : `/asset-logo/${launch.symbol ?? ""}`;

export function HostedLaunchpad({ slug }: Readonly<{ slug: string }>) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [network, setNetwork] = useState<NetworkIdentity | null>(null);
  const [deployment, setDeployment] = useState<DbcAddresses | null>(null);
  const [launches, setLaunches] = useState<readonly DbcLaunch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refreshTimers = useRef<number[]>([]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const refreshAfterTransaction = useCallback(() => {
    refreshTimers.current.forEach((timer) => window.clearTimeout(timer));
    refreshTimers.current = [0, 2_000, 5_000, 10_000, 20_000].map((delay) =>
      window.setTimeout(refresh, delay),
    );
  }, [refresh]);

  useEffect(
    () => () =>
      refreshTimers.current.forEach((timer) => window.clearTimeout(timer)),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    const selectedChainId = activeChainId();
    const configPath =
      selectedChainId && selectedChainId !== 4663
        ? `/v2/chains/${selectedChainId}/config`
        : "/v1/config";
    setLoading(true);
    setError("");
    void Promise.all([
      apiRequest<Branding>(
        webPublicConfig.apiUrl,
        `/v1/launchpads/${encodeURIComponent(slug)}`,
        { signal: controller.signal, cache: "no-store" },
      ),
      apiRequest<NetworkIdentity>(webPublicConfig.apiUrl, configPath, {
        signal: controller.signal,
        cache: "no-store",
      }),
      apiRequest<DbcAddresses>(webPublicConfig.apiUrl, "/v1/dbc/deployment", {
        signal: controller.signal,
        cache: "no-store",
      }),
    ])
      .then(async ([brand, networkResult, deploymentResult]) => {
        const result = await apiRequest<{ items: DbcLaunch[] }>(
          webPublicConfig.apiUrl,
          `/v1/dbc/launches?launchpadId=${encodeURIComponent(brand.launchpadId)}&limit=100`,
          { signal: controller.signal, cache: "no-store" },
        );
        setBranding(brand);
        setNetwork(networkResult);
        setDeployment(deploymentResult);
        setLaunches(result.items);
        setSelectedId((current) =>
          result.items.some((item) => item.launch_id === current)
            ? current
            : (result.items[0]?.launch_id ?? ""),
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "LAUNCHPAD_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, slug]);

  const selected = useMemo(
    () =>
      launches.find((item) => item.launch_id === selectedId) ??
      launches[0] ??
      null,
    [launches, selectedId],
  );
  const [economics, setEconomics] = useState<TemplateEconomics | null>(null);
  useEffect(() => {
    if (!selected) {
      setEconomics(null);
      return;
    }
    const controller = new AbortController();
    void apiRequest<TemplateEconomics>(
      webPublicConfig.apiUrl,
      `/v1/dbc/templates/${selected.template_id}/economics`,
      { signal: controller.signal },
    )
      .then(setEconomics)
      .catch(() => setEconomics(null));
    return () => controller.abort();
  }, [selected?.template_id]);
  const quoteSymbol = economics?.quoteSymbol ?? "QUOTE";
  const quoteDecimals = economics?.quoteDecimals ?? 18;
  if (loading && !branding) return <HostedSkeleton />;
  if (error && !branding)
    return (
      <section className="mx-auto min-h-[70vh] max-w-6xl px-5 py-20 sm:px-8">
        <p className="label">Launchpad unavailable</p>
        <h1 className="mt-4 text-3xl text-white">
          This launchpad could not be loaded.
        </h1>
        <button
          onClick={refresh}
          className="mt-6 border border-line px-4 py-3 font-mono text-xs uppercase"
        >
          Retry
        </button>
      </section>
    );
  if (!branding) return <HostedSkeleton />;

  return (
    <main
      id="main"
      className="min-h-[calc(100vh-var(--header-h))] pt-[var(--header-h)]"
      style={{
        backgroundColor: branding.backgroundColor,
        color: branding.foregroundColor,
      }}
    >
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-5 px-4 py-7 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            {branding.logoUrl ? (
              <img
                className="size-14 rounded-full border border-white/20 object-cover"
                src={apiProxyAssetPath(branding.logoUrl)}
                alt={`${branding.name} logo`}
              />
            ) : (
              <div className="size-14 rounded-full border border-white/20" />
            )}
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-60">
                Powered by ZKBLAST
              </p>
              <h1 className="truncate text-2xl sm:text-3xl">{branding.name}</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {branding.websiteUrl && (
              <a
                className="border border-white/20 px-3 py-2 font-mono text-[10px] uppercase"
                href={branding.websiteUrl}
                target="_blank"
                rel="noreferrer"
              >
                Website <ExternalLink className="ml-1 inline size-3" />
              </a>
            )}
            {branding.xUrl && (
              <a
                className="border border-white/20 px-3 py-2 font-mono text-[10px] uppercase"
                href={branding.xUrl}
                target="_blank"
                rel="noreferrer"
              >
                X <ExternalLink className="ml-1 inline size-3" />
              </a>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1480px] px-3 py-5 sm:px-5">
        <p className="mb-5 max-w-3xl text-sm leading-6 opacity-70">
          {branding.description}
        </p>
        {error && (
          <div
            role="status"
            className="mb-3 border border-danger/50 p-3 text-xs text-danger"
          >
            Live data refresh unavailable · {error}
          </div>
        )}
        <div className="grid min-h-[46rem] overflow-hidden border border-white/15 xl:grid-cols-[18rem_minmax(0,1fr)_23rem]">
          <aside className="min-w-0 border-b border-white/15 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-60">
                Curve markets
              </span>
              <span className="font-mono text-[10px] opacity-60">
                {launches.length}
              </span>
            </div>
            <div
              className="max-h-[30rem] overflow-y-auto p-2 xl:max-h-[42rem]"
              data-lenis-prevent
            >
              {loading && launches.length === 0 ? (
                Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="mb-2 h-20" />
                ))
              ) : launches.length === 0 ? (
                <p className="p-4 text-sm opacity-60">
                  Confirmed launches will appear here.
                </p>
              ) : (
                launches.map((launch) => (
                  <button
                    key={launch.launch_id}
                    onClick={() => setSelectedId(launch.launch_id)}
                    className={`mb-1 flex w-full items-center gap-3 border p-3 text-left transition-colors ${selected?.launch_id === launch.launch_id ? "border-current bg-white/[.06]" : "border-transparent hover:border-white/20"}`}
                  >
                    <AssetLogo
                      url={tokenLogoUrl(launch)}
                      label={launch.symbol ?? "Launch token"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">
                        {launch.symbol ?? shortHex(launch.token_address)}/{quoteSymbol}
                      </span>
                      <span className="mt-1 block text-[10px] opacity-55">
                        {lifecycle[launch.lifecycle] ?? "Onchain"} ·{" "}
                        {(launch.progress_bps / 100).toFixed(1)}%
                      </span>
                      <span className="mt-2 block h-1 bg-white/10">
                        <span
                          className="block h-full"
                          style={{
                            width: `${Math.min(100, launch.progress_bps / 100)}%`,
                            backgroundColor: branding.primaryColor,
                          }}
                        />
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>
          <section className="min-w-0 border-b border-white/15 xl:border-b-0">
            {selected ? (
              <>
                <div className="flex items-center gap-3 border-b border-white/15 p-4 sm:p-5">
                  <AssetLogo
                    url={tokenLogoUrl(selected)}
                    label={selected.symbol ?? "Token"}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate font-mono text-lg">
                      {selected.name ?? selected.symbol ?? "Launch"}
                    </h2>
                    <p className="mt-1 font-mono text-[10px] opacity-55">
                      {shortHex(selected.token_address)} ·{" "}
                      {lifecycle[selected.lifecycle] ?? "Onchain"}
                    </p>
                  </div>
                </div>
                <LaunchChart
                  launchId={selected.launch_id}
                  symbol={selected.symbol ?? "TOKEN"}
                  quoteSymbol={quoteSymbol}
                  quoteDecimals={quoteDecimals}
                  refreshKey={String(revision)}
                />
                <div className="grid grid-cols-2 gap-px border-y border-white/15 bg-white/15 sm:grid-cols-4">
                  <HostedMetric
                    label="Progress"
                    value={`${(selected.progress_bps / 100).toFixed(2)}%`}
                  />
                  <HostedMetric
                    label="Trades"
                    value={String(selected.trade_count ?? 0)}
                  />
                  <HostedMetric
                    label="Holders"
                    value={String(selected.holder_count ?? 0)}
                  />
                  <HostedMetric
                    label="Lifecycle"
                    value={lifecycle[selected.lifecycle] ?? "Onchain"}
                  />
                </div>
                <LaunchTradeHistory
                  launchId={selected.launch_id}
                  symbol={selected.symbol ?? "TOKEN"}
                  quoteSymbol={quoteSymbol}
                  quoteDecimals={quoteDecimals}
                  refreshKey={String(revision)}
                />
              </>
            ) : (
              <div className="grid min-h-[36rem] place-items-center p-8 text-sm opacity-60">
                No confirmed launch is available.
              </div>
            )}
          </section>
          {selected && deployment ? (
            <LaunchActions
              launch={selected}
              deployment={deployment}
              onComplete={refreshAfterTransaction}
            />
          ) : loading ? (
            <aside className="border-l border-white/15 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="mt-5 h-72 w-full" />
            </aside>
          ) : (
            <aside className="border-l border-white/15 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-55">
                Launch execution
              </p>
              <div className="mt-5 border border-white/15 p-5 text-sm leading-6 opacity-65">
                {selected
                  ? "Trading configuration is temporarily unavailable. Refresh this page to retry."
                  : "No token has been launched here yet. Confirmed launches will make the trading controls available."}
              </div>
            </aside>
          )}
        </div>
        <footer className="mt-4 flex flex-wrap justify-between gap-3 border-t border-white/15 py-4 font-mono text-[10px] uppercase opacity-55">
          <span>ZKBLAST · {network?.environment ?? "network"}</span>
          <span>
            {network
              ? `${network.chainName} · ${network.chainId}`
              : "Loading network identity"}
          </span>
        </footer>
      </div>
    </main>
  );
}

function HostedSkeleton() {
  return (
    <section
      className="mx-auto min-h-[70vh] max-w-[1480px] animate-pulse px-5 py-20 sm:px-8"
      aria-label="Loading launchpad"
    >
      <div className="h-16 w-16 rounded-full bg-white/10" />
      <div className="mt-8 h-9 w-2/3 bg-white/10" />
      <div className="mt-8 grid gap-3 xl:grid-cols-[18rem_1fr_23rem]">
        <div className="h-[36rem] bg-white/5" />
        <div className="h-[36rem] bg-white/5" />
        <div className="h-[36rem] bg-white/5" />
      </div>
    </section>
  );
}
function HostedMetric({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="bg-bg p-4">
      <p className="font-mono text-[10px] uppercase opacity-50">{label}</p>
      <p className="mt-2 font-mono text-sm">{value}</p>
    </div>
  );
}
