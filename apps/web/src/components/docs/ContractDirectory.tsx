"use client";

import { Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getChainDescriptor } from "@zkblast/config";
import { useApp } from "@/components/shell/AppProvider";
import { NetworkLogo } from "@/components/shell/NetworkLogo";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { parsePublicConfig } from "@/lib/network-config";
import type { PublicConfig } from "@/types/application";

function explorerAddressUrl(explorerUrl: string, address: string) {
  return `${explorerUrl.replace(/\/$/u, "")}/address/${address}`;
}

function AddressRow({
  address,
  explorerUrl,
  label,
}: Readonly<{ address: string; explorerUrl: string; label: string }>) {
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    void navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_800);
      })
      .catch(() => setCopied(false));
  }

  return (
    <div className="rounded-md border border-line bg-bg/40 p-3">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-faint">
        {label}
      </p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed text-fg">
          {address}
        </code>
        <button
          type="button"
          onClick={copyAddress}
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:border-lime/50 hover:text-lime"
          aria-label={`Copy ${label} ${address}`}
          title={`Copy ${label}`}
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </button>
        <a
          href={explorerAddressUrl(explorerUrl, address)}
          target="_blank"
          rel="noreferrer"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:border-lime/50 hover:text-lime"
          aria-label={`Open ${label} ${address} in block explorer`}
          title="Open in block explorer"
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      </div>
    </div>
  );
}

function DeploymentSection({ config }: Readonly<{ config: PublicConfig }>) {
  const contracts = config.contracts ?? [];
  const family = getChainDescriptor(config.chainId).family;
  return (
    <section
      className="space-y-4"
      aria-labelledby={`deployment-${config.chainId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-lime/30 bg-lime/[0.04] p-4">
        <div className="flex items-center gap-3">
          <NetworkLogo family={family} className="size-8" />
          <div>
          <p className="font-mono text-[11px] uppercase tracking-wide text-lime">
            Mainnet deployment
          </p>
          <p id={`deployment-${config.chainId}`} className="mt-1 text-sm text-fg">
            {config.chainName} · Chain ID {config.chainId}
          </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase text-muted">
          <ShieldCheck className="size-3.5 text-lime" aria-hidden />
          {config.environment}
        </span>
      </div>

      {contracts.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">
          No contracts are published in the active deployment manifest.
        </div>
      ) : (
        contracts.map((contract) => (
          <section key={contract.name} className="panel p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-fg">{contract.name}</h3>
                <p className="mt-1 text-xs text-muted">
                  {contract.proxyKind === "uups"
                    ? "Upgradeable UUPS proxy"
                    : "Direct contract"}
                </p>
              </div>
              <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase text-muted">
                {contract.proxyKind === "uups" ? "Proxy" : "Onchain"}
              </span>
            </div>
            <div className="space-y-3">
              {contract.proxyAddress ? (
                <AddressRow
                  address={contract.proxyAddress}
                  explorerUrl={config.explorerUrl}
                  label="Stable proxy address"
                />
              ) : null}
              <AddressRow
                address={contract.implementationAddress}
                explorerUrl={config.explorerUrl}
                label={
                  contract.proxyAddress
                    ? "Current implementation address"
                    : "Contract address"
                }
              />
            </div>
          </section>
        ))
      )}
    </section>
  );
}

export function ContractDirectory() {
  const { chains, config } = useApp();
  const [deployments, setDeployments] = useState<readonly PublicConfig[]>([]);

  useEffect(() => {
    if (!config) return;
    const controller = new AbortController();
    const targets = chains.filter(
      (chain) => chain.configured && chain.environment === "mainnet",
    );

    void Promise.all(
      targets.map(async (chain) => {
        if (chain.chainId === config.chainId) return config;
        const response = await apiRequest<unknown>(
          webPublicConfig.apiUrl,
          `/v2/chains/${chain.chainId}/config`,
          { signal: controller.signal },
        );
        return parsePublicConfig(response);
      }),
    )
      .then((items) => setDeployments(items))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDeployments([config]);
      });

    return () => controller.abort();
  }, [chains, config]);

  if (!config || deployments.length === 0) {
    return (
      <div className="panel mt-6 p-5 text-sm text-muted">
        Loading deployment manifests…
      </div>
    );
  }

  return (
    <div
      className="mt-7 space-y-10"
      aria-label="Multichain deployed contract directory"
    >
      {deployments.map((deployment) => (
        <DeploymentSection key={deployment.chainId} config={deployment} />
      ))}
    </div>
  );
}
