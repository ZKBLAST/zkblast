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
      <div className="panel p-8 text-sm text-muted">
        Reading finalized {network} data from the ZKBLAST API.
      </div>
    );
  if (error)
    return (
      <div className="panel p-8">
        <p className="text-sm text-danger">
          {network[0]?.toUpperCase()}
          {network.slice(1)} data is unavailable: {error}
        </p>
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => void onRetry()}
        >
          <RefreshCw className="size-4" /> Retry
        </Button>
      </div>
    );
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
