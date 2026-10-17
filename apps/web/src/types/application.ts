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

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
