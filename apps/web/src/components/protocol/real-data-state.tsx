"use client";

import { Database, RefreshCw } from "lucide-react";

import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";

export function RealDataState({
  loading,
  error,
  empty,
  onRetry,
}: Readonly<{
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => Promise<void>;
}>) {
  const { config } = useApp();
  const network = config?.environment ?? "network";
  if (loading)
    return (
      <div
        className="panel p-8 text-sm text-muted"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        Reading finalized {network} data from the ZKBLAST API.
      </div>
    );
  if (error) {
    const detail = operationalError(error);
    return (
      <div className="panel p-8" role="alert">
        <p className="text-sm text-danger">
          {network[0]?.toUpperCase()}{network.slice(1)} data is unavailable.
        </p>
        <p className="mt-2 text-xs text-muted">{detail.message}</p>
        <code className="mt-2 block w-fit border border-line px-2 py-1 font-mono text-[10px] text-faint">
          {detail.code}
        </code>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => void onRetry()}
        >
          <RefreshCw className="size-4" /> Retry
        </Button>
      </div>
    );
  }
  if (empty)
    return (
      <div className="panel flex items-start gap-3 p-8">
        <Database className="size-5 text-muted" aria-hidden />
        <div>
          <p className="font-semibold">No validated {network} records yet</p>
          <p className="mt-1 text-sm text-muted">
            The indexer has not stored a matching finalized on-chain event. No
            placeholder value is shown.
          </p>
        </div>
      </div>
    );
  return null;
}

function operationalError(error: string) {
  const code = /^[A-Z][A-Z0-9_]*$/u.test(error) ? error : "REQUEST_FAILED";
  if (code === "HTTP_429")
    return { code, message: "Request limit reached. Wait briefly, then retry." };
  if (code === "HTTP_401" || code === "HTTP_403")
    return { code, message: "Reconnect or sign in again, then retry." };
  if (code === "HTTP_404")
    return { code, message: "This network resource is not available in the active deployment." };
  return { code, message: "Retry the request. If it persists, confirm the selected network and API status." };
}
