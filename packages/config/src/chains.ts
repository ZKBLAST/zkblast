export type ChainEnvironment = "testnet" | "mainnet";
export type ChainFamily = "robinhood" | "hyperevm" | "elysium";

export type ChainCapabilities = Readonly<{
  launchpad: boolean;
  dbc: boolean;
  dammGraduation: boolean;
  dlmmGraduation: boolean;
  zkClaimAuthorization: boolean;
  customDomains: boolean;
  metadataUpload: boolean;
  protectedLaunch: boolean;
  xAttestation: boolean;
  bridgeUx: boolean;
  optionalZkModules: boolean;
}>;

export type ChainDescriptor = Readonly<{
  chainId: number;
  slug: string;
  family: ChainFamily;
  environment: ChainEnvironment;
  name: string;
  nativeCurrency: Readonly<{
    name: string;
    symbol: string;
    decimals: 18;
  }>;
  publicRpcUrls: readonly string[];
  explorerUrl: string | null;
  indexer: Readonly<{
    confirmations: number | null;
    pollIntervalMs: number;
    maximumLogRange: number | null;
    officialWebsocket: boolean;
  }>;
  execution: Readonly<{
    fastBlockGasLimit: number | null;
    slowBlockGasLimit: number | null;
    maximumQueuedNonces: number | null;
  }>;
  databaseSchema: string;
  deploymentManifestPath: string;
  capabilities: ChainCapabilities;
}>;

const phaseOneCapabilities: ChainCapabilities = {
  launchpad: true,
  dbc: true,
  dammGraduation: true,
  dlmmGraduation: true,
  zkClaimAuthorization: true,
  customDomains: true,
  metadataUpload: true,
  protectedLaunch: true,
  xAttestation: true,
  bridgeUx: false,
  optionalZkModules: true,
};

const phaseTwoDisabledCapabilities: ChainCapabilities = {
  launchpad: false,
  dbc: false,
  dammGraduation: false,
  dlmmGraduation: false,
  zkClaimAuthorization: false,
  customDomains: false,
  metadataUpload: false,
  protectedLaunch: false,
  xAttestation: false,
  bridgeUx: false,
  optionalZkModules: false,
};

const hyperEvmMainnetCapabilities: ChainCapabilities = {
  launchpad: true,
  dbc: true,
  dammGraduation: true,
  dlmmGraduation: false,
  zkClaimAuthorization: false,
  customDomains: false,
  metadataUpload: true,
  protectedLaunch: true,
  xAttestation: true,
  bridgeUx: false,
  optionalZkModules: false,
};

const descriptors = [
  {
    chainId: 46_630,
    slug: "robinhood-testnet",
    family: "robinhood",
    environment: "testnet",
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    publicRpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    indexer: {
      confirmations: 5,
      pollIntervalMs: 1_000,
      maximumLogRange: 2_000,
      officialWebsocket: true,
    },
    execution: {
      fastBlockGasLimit: null,
      slowBlockGasLimit: null,
      maximumQueuedNonces: null,
    },
    databaseSchema: "zkblast_testnet",
    deploymentManifestPath: "deployments/testnet/manifest.json",
    capabilities: phaseOneCapabilities,
  },
  {
    chainId: 4_663,
    slug: "robinhood-mainnet",
    family: "robinhood",
    environment: "mainnet",
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    publicRpcUrls: [
      "https://robinhood-rpc.publicnode.com",
      "https://robinhood.drpc.org",
      "https://robinhood.rpc.pinax.network",
      "https://rpc.mainnet.chain.robinhood.com",
    ],
    explorerUrl: "https://robinhoodchain.blockscout.com",
    indexer: {
      confirmations: 12,
      pollIntervalMs: 1_000,
      maximumLogRange: 2_000,
      officialWebsocket: true,
    },
    execution: {
      fastBlockGasLimit: null,
      slowBlockGasLimit: null,
      maximumQueuedNonces: null,
    },
    databaseSchema: "zkblast_mainnet",
    deploymentManifestPath: "deployments/mainnet/manifest.json",
    capabilities: phaseOneCapabilities,
  },
  {
    chainId: 99_801,
    slug: "elysium-testnet",
    family: "elysium",
    environment: "testnet",
    name: "Elysium Testnet",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    publicRpcUrls: ["https://testnet-rpc.elysium.kinetiq.xyz"],
    explorerUrl: "https://elysium.kinetiq.xyz/testnet-explorer",
    indexer: {
      confirmations: null,
      pollIntervalMs: 250,
      maximumLogRange: 2_000,
      officialWebsocket: false,
    },
    execution: {
      fastBlockGasLimit: null,
      slowBlockGasLimit: null,
      maximumQueuedNonces: null,
    },
    databaseSchema: "zkblast_elysium_testnet",
    deploymentManifestPath: "deployments/elysium-testnet/manifest.json",
    capabilities: phaseTwoDisabledCapabilities,
  },
  {
    chainId: 998,
    slug: "hyperevm-testnet",
    family: "hyperevm",
    environment: "testnet",
    name: "HyperEVM Testnet",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    publicRpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
    explorerUrl: null,
    indexer: {
      confirmations: null,
      pollIntervalMs: 1_000,
      maximumLogRange: 50,
      officialWebsocket: false,
    },
    execution: {
      fastBlockGasLimit: 2_000_000,
      slowBlockGasLimit: 30_000_000,
      maximumQueuedNonces: 8,
    },
    databaseSchema: "zkblast_hyperevm_testnet",
    deploymentManifestPath: "deployments/hyperevm-testnet/manifest.json",
    capabilities: phaseTwoDisabledCapabilities,
  },
  {
    chainId: 999,
    slug: "hyperevm-mainnet",
    family: "hyperevm",
    environment: "mainnet",
    name: "HyperEVM",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    publicRpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
    explorerUrl: "https://www.hyperscan.com",
    indexer: {
      confirmations: null,
      pollIntervalMs: 1_000,
      maximumLogRange: 50,
      officialWebsocket: false,
    },
    execution: {
      fastBlockGasLimit: 2_000_000,
      slowBlockGasLimit: 30_000_000,
      maximumQueuedNonces: 8,
    },
    databaseSchema: "zkblast_hyperevm_mainnet",
    deploymentManifestPath: "deployments/hyperevm-mainnet/manifest.json",
    capabilities: hyperEvmMainnetCapabilities,
  },
] as const satisfies readonly ChainDescriptor[];

const descriptorByChainId: ReadonlyMap<number, ChainDescriptor> = new Map(
  descriptors.map((descriptor) => [descriptor.chainId, descriptor]),
);

export const supportedChains: readonly ChainDescriptor[] = descriptors;

export function getChainDescriptor(chainId: number): ChainDescriptor {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error("CHAIN_ID_INVALID");
  const descriptor = descriptorByChainId.get(chainId);
  if (!descriptor) throw new Error(`CHAIN_ID_UNSUPPORTED:${chainId}`);
  return descriptor;
}

export function isSupportedChainId(chainId: number): boolean {
  return descriptorByChainId.has(chainId);
}

export function isSupportedDatabaseSchema(schema: string): boolean {
  return descriptors.some((descriptor) => descriptor.databaseSchema === schema);
}
