"use client";

import {
  Activity,
  AlertTriangle,
  CircleDollarSign,
  Coins,
  ExternalLink,
  LogIn,
  Plus,
  RefreshCw,
  Router,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatTokenAmount } from "@zkblast/sdk";
import { useApp } from "@/components/shell/AppProvider";
import { Skeleton } from "@/components/ui/Skeleton";
import { shortHex } from "@/lib/format";
import { apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";
import type { DbcLaunch, TemplateEconomics } from "./types";
import { LaunchpadDeveloperSettings } from "./LaunchpadDeveloperSettings";
import { getTemplateEconomics } from "@/lib/template-economics";

export type PendingLaunchpad = Readonly<{
  launchpadId: string;
  name: string;
  slug: string;
  owner: string;
  treasury: string;
  presetId: string;
  transactionHash: string;
  reconciliation: "confirmed" | "onchain" | "published" | "failed";
}>;
type OwnedLaunchpadRecord = Readonly<{
  launchpadId: string;
  slug: string | null;
  owner: string;
  treasury: string;
  operator: string;
  configPresetId: string;
  status: number;
  updatedAt: string;
}>;
type AvailablePreset = Readonly<{
  presetId: string;
  dbcTemplateId: string;
  graduationDestination: number;
  quoteSymbol: string;
}>;

export function LaunchpadOwnerDashboard({
  launches,
  pendingLaunchpads,
  loading,
  onBuild,
  onCreateToken,
  onRefresh,
  onRetryPending,
  quoteSymbol,
  economicsByTemplateId,
}: Readonly<{
  launches: readonly DbcLaunch[];
  pendingLaunchpads: readonly PendingLaunchpad[];
  loading: boolean;
  onBuild: (presetId?: string) => void;
  onCreateToken: (launchpadId: string) => void;
  onRefresh: () => void;
  onRetryPending: (item: PendingLaunchpad) => void;
  quoteSymbol: string;
  economicsByTemplateId: Readonly<Record<string, TemplateEconomics>>;
}>) {
  const {
    address,
    injectedAddress,
    walletChainId,
    config,
    busy,
    connect,
    loginInjected,
    switchNetwork,
  } = useApp();
  const [ownedRecords, setOwnedRecords] = useState<
    readonly OwnedLaunchpadRecord[]
  >([]);
  const [ownerDiscoveryFailed, setOwnerDiscoveryFailed] = useState(false);
  const [ownerDiscoveryLoading, setOwnerDiscoveryLoading] = useState(false);
  const [availablePresets, setAvailablePresets] = useState<
    readonly AvailablePreset[]
  >([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  useEffect(() => {
    if (!config?.capabilities.launchpad) {
      setAvailablePresets([]);
      return;
    }
    let cancelled = false;
    setPresetsLoading(true);
    void apiRequest<{
      items: readonly Readonly<{
        presetId: string;
        dbcTemplateId: string;
        graduationDestination: number;
      }>[];
    }>(webPublicConfig.apiUrl, "/v1/launchpads/presets")
      .then(async ({ items }) =>
        Promise.allSettled(
          items.map(async (preset) => ({
            ...preset,
            quoteSymbol: (await getTemplateEconomics(preset.dbcTemplateId))
              .quoteSymbol,
          })),
        ),
      )
      .then((results) => {
        if (cancelled) return;
        setAvailablePresets(
          results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setAvailablePresets([]);
      })
      .finally(() => {
        if (!cancelled) setPresetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config?.capabilities.launchpad, config?.chainId]);
  useEffect(() => {
    if (!address) {
      setOwnedRecords([]);
      setOwnerDiscoveryLoading(false);
      return;
    }
    const controller = new AbortController();
    setOwnerDiscoveryFailed(false);
    setOwnerDiscoveryLoading(true);
    void apiRequest<{ items: OwnedLaunchpadRecord[] }>(
      webPublicConfig.apiUrl,
      `/v1/launchpads/records?owner=${encodeURIComponent(address)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((result) => setOwnedRecords(result.items))
      .catch(() => {
        if (!controller.signal.aborted) setOwnerDiscoveryFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOwnerDiscoveryLoading(false);
      });
    return () => controller.abort();
  }, [address]);
  const ownedIds = new Set(ownedRecords.map((item) => item.launchpadId));
  const owned = address
    ? launches.filter(
        (launch) =>
          launch.launchpad_bound &&
          (launch.launchpad_id
            ? ownedIds.has(launch.launchpad_id) ||
              (ownerDiscoveryFailed &&
                (launch.creator.toLowerCase() === address.toLowerCase() ||
                  launch.launchpad_treasury?.toLowerCase() ===
                    address.toLowerCase()))
            : false),
      )
    : [];
  const pending = address
    ? pendingLaunchpads.filter(
        (item) => item.owner.toLowerCase() === address.toLowerCase(),
      )
    : [];
  const totalTrades = owned.reduce(
    (total, launch) => total + (launch.trade_count ?? 0),
    0,
  );
  const totalsByQuote = owned.reduce<
    Record<
      string,
      { decimals: number; volumeRaw: bigint; claimableRaw: bigint }
    >
  >((result, launch) => {
    const launchEconomics = economicsByTemplateId[launch.template_id];
    const symbol = launchEconomics?.quoteSymbol ?? "Quote";
    const current = result[symbol] ?? {
      decimals: launchEconomics?.quoteDecimals ?? 18,
      volumeRaw: 0n,
      claimableRaw: 0n,
    };
    result[symbol] = {
      ...current,
      volumeRaw: current.volumeRaw + BigInt(launch.volume_raw ?? "0"),
      claimableRaw:
        current.claimableRaw + BigInt(launch.creator_claimable_raw ?? "0"),
    };
    return result;
  }, {});
  const formattedQuoteTotal = (
    field: "volumeRaw" | "claimableRaw",
  ) =>
    Object.entries(totalsByQuote)
      .map(
        ([symbol, total]) =>
          `${formatTokenAmount(total[field], total.decimals)} ${symbol}`,
      )
      .join(" · ") || `0 ${quoteSymbol}`;
  const latestIndexedBlock = owned.reduce((latest, launch) => {
    const block = BigInt(launch.updated_block);
    return block > latest ? block : latest;
  }, 0n);
  const walletMatchesSession = Boolean(
    address &&
    injectedAddress &&
    address.toLowerCase() === injectedAddress.toLowerCase(),
  );
  const wrongNetwork = Boolean(
    config && walletChainId !== null && walletChainId !== config.chainId,
  );
  const hostedSlugById = new Map(
    ownedRecords.flatMap((record) =>
      record.slug ? [[record.launchpadId, record.slug] as const] : [],
    ),
  );
  const launchpadHref = (launchpadId: string) => {
    const slug = hostedSlugById.get(launchpadId);
    return slug
      ? `/launchpads/${encodeURIComponent(slug)}`
      : `/launch?launchpad=${launchpadId}`;
  };
  if (!injectedAddress || !walletMatchesSession || wrongNetwork)
    return (
      <section className="panel ticks grid min-h-[28rem] place-items-center p-6 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid size-11 place-items-center border border-line bg-raised">
            {!injectedAddress ? (
              <Wallet className="size-5" aria-hidden />
            ) : wrongNetwork ? (
              <Router className="size-5" aria-hidden />
            ) : (
              <LogIn className="size-5" aria-hidden />
            )}
          </div>
          <p className="label mt-4">My launchpads</p>
          <h2 className="mt-3 text-2xl">
            {!injectedAddress
              ? "Connect your wallet"
              : wrongNetwork
                ? `Switch to ${config?.chainName ?? "the configured network"}`
                : "Sign in to continue"}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
            {!injectedAddress
              ? "Connect the owner wallet to view and manage its launchpads."
              : wrongNetwork
                ? "The connected wallet must match the network configured for this ZKBLAST deployment."
                : "Confirm the login signature to load launchpads controlled by this wallet. This does not submit an onchain transaction."}
          </p>
          {injectedAddress && (
            <p className="mt-3 font-mono text-xs text-muted">
              Wallet · {shortHex(injectedAddress)}
            </p>
          )}
          <button
            onClick={() => {
              if (!injectedAddress) connect();
              else if (wrongNetwork) void switchNetwork();
              else void loginInjected();
            }}
            disabled={busy}
            className="mt-6 inline-flex min-w-48 items-center justify-center gap-2 bg-lime px-6 py-3 font-mono text-xs uppercase text-lime-ink disabled:cursor-wait disabled:opacity-60"
          >
            {busy && <RefreshCw className="size-4 animate-spin" aria-hidden />}
            {!injectedAddress
              ? "Connect wallet"
              : wrongNetwork
                ? "Switch network"
                : "Sign in"}
          </button>
        </div>
      </section>
    );
  return (
    <section className="panel ticks overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5">
        <div>
          <p className="label">Connected owner</p>
          <p className="mt-2 font-mono text-sm">{shortHex(address!)}</p>
        </div>
        <button
              onClick={() => onBuild()}
          className="flex items-center gap-2 bg-lime px-5 py-3 font-mono text-xs uppercase text-lime-ink"
        >
          <Plus className="size-4" />
          Build launchpad
        </button>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 border border-line px-4 py-3 font-mono text-xs uppercase text-muted hover:text-fg"
        >
          <RefreshCw className="size-4" /> Refresh
        </button>
      </div>
      <div className="p-4 sm:p-6">
        {ownerDiscoveryFailed && (
          <p
            role="status"
            className="mb-4 border border-line p-3 text-xs text-muted"
          >
            Owner records are temporarily unavailable. Showing the safe
            creator/treasury fallback.
          </p>
        )}
        <div className="mb-5 grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-5">
          <Metric icon={Coins} label="Tokens" value={owned.length.toString()} />
          <Metric
            icon={Activity}
            label="Trades"
            value={totalTrades.toLocaleString()}
          />
          <Metric
            icon={CircleDollarSign}
            label="Recorded volume"
            value={formattedQuoteTotal("volumeRaw")}
          />
          <Metric
            icon={CircleDollarSign}
            label="Creator claimable"
            value={formattedQuoteTotal("claimableRaw")}
          />
          <Metric
            icon={AlertTriangle}
            label="Failed reconciliation"
            value={pending
              .filter((item) => item.reconciliation === "failed")
              .length.toString()}
          />
        </div>
        {(presetsLoading || availablePresets.length > 0) && (
          <section className="mb-5 border border-line p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="label">Available launchpad presets</p>
                <p className="mt-1 text-xs text-muted">
                  Choose the quote asset and graduation destination before the
                  launchpad is created. This binding is immutable onchain.
                </p>
              </div>
            </div>
            {presetsLoading ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {availablePresets.map((preset) => (
                  <article
                    key={preset.presetId}
                    className="border border-line bg-bg p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm">
                          {preset.quoteSymbol} ·{" "}
                          {preset.graduationDestination === 2 ? "DLMM" : "DAMM"}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          Preset {preset.presetId} · Template {preset.dbcTemplateId}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onBuild(preset.presetId)}
                      className="mt-4 flex items-center gap-2 border border-line px-3 py-2 font-mono text-[10px] uppercase hover:border-lime/70"
                    >
                      <Plus className="size-3" /> Build with this preset
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {pending.length > 0 && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((item) => (
              <article
                key={item.launchpadId}
                className="border border-lime bg-white/[.03] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm">{item.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      Launchpad {item.launchpadId}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted">
                    <span
                      className={`size-2 ${item.reconciliation === "failed" ? "bg-danger" : item.reconciliation === "published" ? "bg-lime" : "animate-pulse bg-lime"}`}
                    />
                    {item.reconciliation}
                  </span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted">Slug</dt>
                  <dd className="text-right">{item.slug}</dd>
                  <dt className="text-muted">Preset</dt>
                  <dd className="text-right">{item.presetId}</dd>
                  <dt className="text-muted">Treasury</dt>
                  <dd className="text-right font-mono">
                    {shortHex(item.treasury)}
                  </dd>
                </dl>
                <p className="mt-4 font-mono text-[10px] text-muted">
                  Receipt {shortHex(item.transactionHash)}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  {item.transactionHash.startsWith("0x") && (
                    <a
                      href={`${config?.explorerUrl ?? ""}/tx/${item.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-muted hover:text-fg"
                    >
                      Explorer <ExternalLink className="size-3" />
                    </a>
                  )}
                  {item.reconciliation === "failed" && (
                    <button
                      onClick={() => onRetryPending(item)}
                      className="flex items-center gap-1 text-xs text-danger hover:text-fg"
                    >
                      <RefreshCw className="size-3" /> Retry reconciliation
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {ownedRecords.length > 0 && (
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="label">Your launchpads</p>
              <p className="mt-1 text-xs text-muted">
                Choose one launchpad before creating a token.
              </p>
            </div>
          </div>
        )}
        {ownedRecords.length > 0 && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ownedRecords.map((record) => (
              <article
                key={record.launchpadId}
                className="border border-line p-5"
              >
                <p className="font-mono text-sm">
                  Launchpad {record.launchpadId}
                </p>
                <p className="mt-2 text-xs text-muted">
                  Onchain and owner-verified ·{" "}
                  {
                    owned.filter(
                      (launch) => launch.launchpad_id === record.launchpadId,
                    ).length
                  }{" "}
                  token(s).
                </p>
                <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted">Preset</dt>
                  <dd className="text-right">{record.configPresetId}</dd>
                  <dt className="text-muted">Treasury</dt>
                  <dd className="text-right font-mono">
                    {shortHex(record.treasury)}
                  </dd>
                  <dt className="text-muted">Status</dt>
                  <dd className="text-right">
                    {record.status === 1 ? "Active" : `State ${record.status}`}
                  </dd>
                </dl>
                <a
                  href={launchpadHref(record.launchpadId)}
                  className="mt-5 flex items-center gap-2 text-xs text-muted hover:text-fg"
                >
                  {record.slug
                    ? "Open hosted page"
                    : "Open launchpad workspace"}
                  <ExternalLink className="size-3" />
                </a>
                <button
                  onClick={() => onCreateToken(record.launchpadId)}
                  className="mt-4 flex items-center gap-2 bg-lime px-4 py-2 font-mono text-[10px] uppercase text-lime-ink"
                >
                  <Plus className="size-3" /> Create token here
                </button>
              </article>
            ))}
          </div>
        )}
        {loading || ownerDiscoveryLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32" />
            ))}
          </div>
        ) : owned.length === 0 &&
          pending.length === 0 &&
          ownedRecords.length === 0 ? (
          <div className="grid min-h-64 place-items-center border border-line p-6 text-center">
            <div>
              <p className="text-lg">
                No launchpad-bound products for this wallet.
              </p>
              <p className="mt-2 text-sm text-muted">
                Create a launchpad first, then its tokens and activity will be
                grouped here.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {owned.map((launch) => (
              (() => {
                const launchEconomics =
                  economicsByTemplateId[launch.template_id];
                const launchQuoteSymbol =
                  launchEconomics?.quoteSymbol ?? "Quote";
                const launchQuoteDecimals =
                  launchEconomics?.quoteDecimals ?? 18;
                return (
              <article
                key={launch.launch_id}
                className="border border-line p-5"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm">
                      {launch.name ?? launch.symbol ?? "Launch"}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      Launchpad {launch.launchpad_id}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-muted">
                    {launch.lifecycle === 4
                      ? "Graduated"
                      : `${(launch.progress_bps / 100).toFixed(1)}%`}
                  </span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted">Trades</dt>
                  <dd className="text-right">{launch.trade_count ?? 0}</dd>
                  <dt className="text-muted">Holders</dt>
                  <dd className="text-right">{launch.holder_count ?? 0}</dd>
                  <dt className="text-muted">Volume</dt>
                  <dd className="text-right font-mono">
                    {formatTokenAmount(
                      BigInt(launch.volume_raw ?? "0"),
                      launchQuoteDecimals,
                    )}{" "}
                    {launchQuoteSymbol}
                  </dd>
                  <dt className="text-muted">Creator claimable</dt>
                  <dd className="text-right font-mono">
                    {formatTokenAmount(
                      BigInt(launch.creator_claimable_raw ?? "0"),
                      launchQuoteDecimals,
                    )}{" "}
                    {launchQuoteSymbol}
                  </dd>
                  <dt className="text-muted">Fee snapshot</dt>
                  <dd className="text-right font-mono">
                    {launch.fee_snapshot_id
                      ? shortHex(launch.fee_snapshot_id)
                      : "Pending token binding"}
                  </dd>
                  <dt className="text-muted">Referral</dt>
                  <dd className="text-right">
                    {launch.fee_snapshot_id
                      ? "Snapshotted per token"
                      : "Not snapshotted"}
                  </dd>
                  <dt className="text-muted">Graduation</dt>
                  <dd className="text-right">
                    {launch.graduation_status
                      ? launch.graduation_status.replaceAll("_", " ")
                      : launch.lifecycle === 4
                        ? "Complete"
                        : launch.lifecycle === 3
                          ? "Ready"
                          : `${(launch.progress_bps / 100).toFixed(2)}%`}
                  </dd>
                  {launch.graduation_status && (
                    <>
                      <dt className="text-muted">Attempts</dt>
                      <dd className="text-right">
                        {launch.graduation_attempts ?? 0}
                      </dd>
                    </>
                  )}
                  {launch.graduation_failure_hash && (
                    <>
                      <dt className="text-muted">Failure receipt</dt>
                      <dd className="text-right font-mono">
                        {shortHex(launch.graduation_failure_hash)}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted">Freshness</dt>
                  <dd className="text-right font-mono">
                    Block {launch.updated_block}
                    {BigInt(launch.updated_block) === latestIndexedBlock
                      ? " · latest"
                      : ""}
                  </dd>
                  <dt className="text-muted">Token</dt>
                  <dd className="text-right font-mono">
                    {shortHex(launch.token_address)}
                  </dd>
                </dl>
                {launch.launchpad_id && (
                  <div className="mt-5 flex flex-wrap gap-4">
                    <a
                      href={launchpadHref(launch.launchpad_id)}
                      className="flex items-center gap-2 text-xs text-muted hover:text-fg"
                    >
                      Open hosted page <ExternalLink className="size-3" />
                    </a>
                    {launch.graduation_transaction_hash && (
                      <a
                        href={`${config?.explorerUrl ?? ""}/tx/${launch.graduation_transaction_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-xs text-muted hover:text-fg"
                      >
                        Graduation receipt <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}
              </article>
                );
              })()
            ))}
          </div>
        )}
        <LaunchpadDeveloperSettings
          launchpadIds={ownedRecords.map((record) => record.launchpadId)}
        />
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: Readonly<{
  icon: typeof AlertTriangle;
  label: string;
  value: string;
}>) {
  return (
    <div className="bg-bg p-4">
      <Icon className="size-4 text-lime" />
      <p className="mt-3 label">{label}</p>
      <p className="mt-2 break-all font-mono text-sm">{value}</p>
    </div>
  );
}
