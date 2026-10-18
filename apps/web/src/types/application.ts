export type EthereumProvider = Readonly<{
  request(
    input: Readonly<{ method: string; params?: unknown[] }>,
  ): Promise<unknown>;
}>;

export type PublicConfig = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
  shielded?: Readonly<{
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
  openedAt: string;
  updatedAt: string;
  poolAddress: string;
  model: "damm" | "dlmm";
  token0Symbol: string;
  token1Symbol: string;
}>;

export type IndexerMetrics = Readonly<{
  ready: boolean;
  rpcHead: string;
  indexedBlock: string | null;
  finalizedBlock?: string;
  lag: string | null;
  checkpointUpdatedAt?: string;
}>;

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
