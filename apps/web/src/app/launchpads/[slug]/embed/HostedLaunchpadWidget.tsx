"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AssetLogo } from "@/components/markets/AssetLogo";
import type {
  DbcLaunch,
  TemplateEconomics,
} from "@/components/launchpad/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { webPublicConfig } from "@/config/public-env";
import { apiProxyAssetPath, apiRequest } from "@/lib/api-client";

type WidgetBranding = Readonly<{
  launchpadId: string;
  name: string;
  primaryColor: string;
  backgroundColor: string;
  foregroundColor: string;
  logoUrl: string | null;
}>;

export function HostedLaunchpadWidget({ slug }: Readonly<{ slug: string }>) {
  const [branding, setBranding] = useState<WidgetBranding | null>(null);
  const [launches, setLaunches] = useState<readonly DbcLaunch[]>([]);
  const [economics, setEconomics] = useState<TemplateEconomics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const brand = await apiRequest<WidgetBranding>(
          webPublicConfig.apiUrl,
          `/v1/launchpads/${encodeURIComponent(slug)}`,
          { signal, cache: "no-store" },
        );
        const result = await apiRequest<{ items: DbcLaunch[] }>(
          webPublicConfig.apiUrl,
          `/v1/dbc/launches?launchpadId=${encodeURIComponent(brand.launchpadId)}&limit=12`,
          { signal, cache: "no-store" },
        );
        const templateId = result.items[0]?.template_id;
        const economicsResult = templateId
          ? await apiRequest<TemplateEconomics>(
              webPublicConfig.apiUrl,
              `/v1/dbc/templates/${templateId}/economics`,
              { signal, cache: "no-store" },
            )
          : null;
        setBranding(brand);
        setLaunches(result.items);
        setEconomics(economicsResult);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError(
            reason instanceof Error ? reason.message : "WIDGET_UNAVAILABLE",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [slug],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const colors = branding
    ? {
        backgroundColor: branding.backgroundColor,
        color: branding.foregroundColor,
      }
    : undefined;
  const quoteSymbol = economics?.quoteSymbol ?? "QUOTE";
  return (
    <main className="min-h-screen p-3 sm:p-4" style={colors}>
      <header className="flex items-center justify-between gap-3 border-b border-current/15 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {branding?.logoUrl ? (
            <img
              src={apiProxyAssetPath(branding.logoUrl)}
              alt=""
              className="size-9 rounded-full border border-current/20 object-cover"
            />
          ) : (
            <div className="size-9 rounded-full border border-current/20" />
          )}
          <div className="min-w-0">
            <h1 className="truncate font-mono text-sm">
              {branding?.name ?? "Launchpad"}
            </h1>
            <p className="mt-1 font-mono text-[9px] uppercase opacity-50">
              Powered by ZKBLAST
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh widget"
          className="border border-current/20 p-2 disabled:opacity-40"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>
      {loading && !branding ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="mt-3 border border-danger/50 p-3 text-xs text-danger"
        >
          Widget unavailable · {error}
        </div>
      ) : launches.length === 0 ? (
        <p className="mt-3 border border-current/15 p-4 text-xs opacity-60">
          No confirmed launches yet.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {launches.map((launch) => (
            <a
              key={launch.launch_id}
              href={`/launchpads/${encodeURIComponent(slug)}`}
              target="_top"
              className="flex items-center gap-3 border border-current/15 p-3 hover:bg-white/[.05]"
            >
              <AssetLogo
                url={
                  launch.has_logo && launch.metadata_id
                    ? apiProxyAssetPath(
                        `/v1/dbc/metadata/${launch.metadata_id}/logo`,
                      )
                    : `/asset-logo/${launch.symbol ?? ""}`
                }
                label={launch.symbol ?? "Token"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">
                  {launch.symbol ?? "TOKEN"}/{quoteSymbol}
                </span>
                <span className="mt-1 block text-[10px] opacity-55">
                  {(launch.progress_bps / 100).toFixed(1)}% ·{" "}
                  {launch.trade_count ?? 0} trades
                </span>
                <span className="mt-2 block h-1 bg-white/10">
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.min(100, launch.progress_bps / 100)}%`,
                      backgroundColor: branding?.primaryColor,
                    }}
                  />
                </span>
              </span>
              <ExternalLink className="size-3 shrink-0 opacity-50" />
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
