export type EthereumProvider = Readonly<{
  request(
    input: Readonly<{ method: string; params?: unknown[] }>,
  ): Promise<unknown>;
  on?: (
    event: "accountsChanged",
    listener: (accounts: unknown) => void,
  ) => void;
  removeListener?: (
    event: "accountsChanged",
    listener: (accounts: unknown) => void,
  ) => void;
}>;

export type PublicConfig = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
  contracts?: readonly Readonly<{
    name: string;
    proxyKind: "uups" | "none";
    address: `0x${string}`;
    proxyAddress: `0x${string}` | null;
    implementationAddress: `0x${string}`;
    verification: Readonly<{
      implementation: "pending" | "verified" | "failed";
      proxy: "pending" | "verified" | "failed" | "not_applicable";
      urls: readonly string[];
    }>;
  }>[];
  shielded?: Readonly<{
    launchMode?: "independent-reviewed" | "experimental-single-operator";
    proverRelease?: Readonly<{ manifestPath: string; manifestSha256: string }>;
    vaultAddress: `0x${string}`;
    stateRegistryAddress: `0x${string}`;
    treeVersion: number;
    assets: readonly Readonly<{
      address: `0x${string}`;
      symbol: string;
      decimals: number;
      denominationRaw: string;
    }>[];
  }>;
}>;

export type UserProfile = Readonly<{
  id: string;
  username: string | null;
  loginCount: number;
  lastLoginAt: string | null;
  wallets: readonly Readonly<{ address: string; isPrimary: boolean }>[];
}>;

export type Trade = Readonly<{
  id: string;
  action: string;
  status: string;
  transactionHash: string | null;
  venue: string;
  submittedAt: string;
}>;

export type ProtocolPool = Readonly<{
  chainId: number;
  address: string;
  model: "damm" | "dlmm";
  feeBps: number;
  status: string;
  createdBlock: string;
  token0Address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Address: string;
  token1Symbol: string;
  token1Decimals: number;
}>;

export type ProtocolExecutionPool = Omit<
  ProtocolPool,
  "feeBps" | "createdBlock"
> & {
  feeBps: number | null;
  createdBlock: string | null;
};

export type ProtocolSwap = Readonly<{
  chain_id: number;
  transaction_hash: string;
  log_index: number;
  amount_in_raw: string;
  amount_out_raw: string;
  fee_raw: string;
  block_number: string;
  block_timestamp: string;
}>;

export type ProtocolPosition = Readonly<{
  onchainPositionId: string;
  liquidityRaw: string;
  lowerBound: number | null;
  upperBound: number | null;
  status: string;
  openedAt?: string;
  updatedAt?: string;
  poolAddress: string;
  model: "damm" | "dlmm";
  token0Address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Address: string;
  token1Symbol: string;
  token1Decimals: number;
}>;

export type IndexerMetrics = Readonly<{
  ready: boolean;
  rpcHead: string;
  indexedBlock: string | null;
  finalizedBlock?: string;
  lag: string | null;
  checkpointUpdatedAt?: string;
}>;

export type ExternalMarket = Readonly<{
  id: string;
  source: "pons_graduated" | "robinhood_stock_token";
  externalId: string;
  chainId: number;
  contractAddress: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  quoteLogoUrl: string | null;
  status: "active" | "halted" | "inactive";
  readOnly: boolean;
  marketRegion: "unclassified" | "crypto" | "us" | "china";
  marketCapUsd: string | null;
  marketCapObservedAt: string | null;
  logoUrl: string | null;
  logoStatus: "pending" | "approved" | "rejected" | "missing";
  oracleProvider: string | null;
  pairCandidates: readonly Readonly<{
    quoteSymbol: "USDG" | "WETH" | "ETH";
    logoUrl: string | null;
    quoteAddress: string;
    executionChainId: number;
    baseAddress: string | null;
    priority: number;
    routeStatus: "planned" | "observed" | "validated" | "disabled";
    venue: string | null;
    poolIdentifier: string | null;
    liquidityRaw: string | null;
  }>[];
  validatedAt: string;
  bid: string | null;
  ask: string | null;
  currency: string | null;
  dailyVolume: string | null;
  quoteObservedAt: string | null;
  canTrade: boolean;
  metadata?: Readonly<Record<string, unknown>>;
  provenance: string;
}>;

export type MarketPricePoint = Readonly<{
  priceUnit?: string | null;
  source: "swap" | "oracle" | "reference";
  observedAt: string;
  price: string;
  volume: string | null;
  blockNumber: string | null;
  transactionHash: string | null;
}>;

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
