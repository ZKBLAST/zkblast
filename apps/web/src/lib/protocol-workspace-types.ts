import type { PreparedTransaction } from "./swap-flow";

export type WorkspaceQuote = {
  expiresAt: number;
  chainId: number;
  amountOut: string;
  approval: PreparedTransaction;
  swap: PreparedTransaction;
};

export type PreparedLiquidity = {
  chainId: number;
  approvals: PreparedTransaction[];
  position: PreparedTransaction;
};

export type PoolReserves = {
  reserve0: string;
  reserve1: string;
  totalShares: string;
  minimumLockedLiquidity?: string;
};
