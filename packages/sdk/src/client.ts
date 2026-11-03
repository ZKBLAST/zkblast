import {
  getChainDescriptor,
  parseDeploymentManifest,
  type ChainCapabilities,
  type ChainDescriptor,
  type DeploymentManifest,
} from "@zkblast/config";
import type { Address } from "viem";
import { resolveProtocolAddresses, type ProtocolAddresses } from "./deployments.js";
import { DbcClient, resolveDbcAddresses } from "./dbc.js";
import { SdkError } from "./errors.js";
import { LaunchpadClient, resolveLaunchpadAddresses } from "./launchpad.js";
import { LaunchpadRevenueClient } from "./launchpad-revenue.js";

export type ChainIdReader = Readonly<{
  getChainId: () => Promise<number>;
}>;

export type ZKBlastClientOptions = Readonly<{
  chainId: number;
  publicClient: ChainIdReader;
  walletClient?: ChainIdReader | undefined;
  deploymentManifest?: unknown;
}>;

export type ZKBlastClient = Readonly<{
  chainId: number;
  chain: ChainDescriptor;
  capabilities: ChainCapabilities;
  addresses: ProtocolAddresses | null;
  manifest: DeploymentManifest | null;
  dbc: DbcClient | null;
  launchpad: LaunchpadClient | null;
  revenue: LaunchpadRevenueClient | null;
  assertPublicChain: () => Promise<void>;
  assertWalletChain: () => Promise<void>;
  requireCapability: (capability: keyof ChainCapabilities) => void;
  explorerAddressUrl: (address: Address) => string | null;
  explorerTransactionUrl: (hash: `0x${string}`) => string | null;
}>;

function assertMatchingChain(actual: number, expected: number, source: string): void {
  if (actual !== expected) {
    throw new SdkError(
      "INVALID_CHAIN",
      `${source} chain ${actual} does not match selected chain ${expected}`,
    );
  }
}

export function createZKBlastClient(options: ZKBlastClientOptions): ZKBlastClient {
  const chain = getChainDescriptor(options.chainId);
  const manifest = options.deploymentManifest
    ? parseDeploymentManifest(options.deploymentManifest, {
        environment: chain.environment,
        chainId: chain.chainId,
      })
    : null;
  const addresses = manifest
    ? resolveProtocolAddresses(manifest, {
        environment: chain.environment,
        chainId: chain.chainId,
      })
    : null;
  const explorer = chain.explorerUrl?.replace(/\/$/u, "") ?? null;
  const runtime = { environment: chain.environment, chainId: chain.chainId };
  const dbc = manifest?.dbc
    ? new DbcClient(resolveDbcAddresses(manifest, runtime))
    : null;
  const launchpadAddresses = manifest?.launchpad
    ? resolveLaunchpadAddresses(manifest, runtime)
    : null;
  const launchpad = launchpadAddresses
    ? new LaunchpadClient(launchpadAddresses)
    : null;
  const revenue = launchpadAddresses
    ? new LaunchpadRevenueClient(launchpadAddresses.revenueSplitter)
    : null;

  return Object.freeze({
    chainId: chain.chainId,
    chain,
    capabilities: chain.capabilities,
    addresses,
    manifest,
    dbc,
    launchpad,
    revenue,
    assertPublicChain: async () =>
      assertMatchingChain(
        await options.publicClient.getChainId(),
        chain.chainId,
        "Public client",
      ),
    assertWalletChain: async () => {
      if (!options.walletClient) {
        throw new SdkError("WALLET_REQUIRED", "Wallet client is unavailable");
      }
      assertMatchingChain(
        await options.walletClient.getChainId(),
        chain.chainId,
        "Wallet client",
      );
    },
    requireCapability: (capability) => {
      if (!chain.capabilities[capability]) {
        throw new SdkError(
          "UNSUPPORTED_CAPABILITY",
          `${capability} is disabled on ${chain.slug}`,
        );
      }
    },
    explorerAddressUrl: (address) =>
      explorer ? `${explorer}/address/${address}` : null,
    explorerTransactionUrl: (hash) =>
      explorer ? `${explorer}/tx/${hash}` : null,
  });
}
