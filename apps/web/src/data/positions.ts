export type Position = {
  id: string;
  poolId: string;
  lowerBinOffset?: number; // DLMM: range relative to the active bin
  upperBinOffset?: number;
  shape?: "Spot" | "Curve" | "Bid-Ask";
  depositedUsd: number;
  valueUsd: number;
  baseAmount: number;
  quoteAmount: number;
  unclaimedFeesUsd: number;
  unclaimedBase: number;
  unclaimedQuote: number;
  openedDaysAgo: number;
};

export const positions: Position[] = [
  { id: "pos-7f21", poolId: "weth-usdc-dlmm-10", lowerBinOffset: -12, upperBinOffset: 14, shape: "Curve", depositedUsd: 8_000, valueUsd: 8_412.77, baseAmount: 1.2104, quoteAmount: 4_282.6, unclaimedFeesUsd: 61.42, unclaimedBase: 0.0091, unclaimedQuote: 30.37, openedDaysAgo: 19 },
  { id: "pos-a930", poolId: "eth-usdt-dlmm-25", lowerBinOffset: 6, upperBinOffset: 22, shape: "Bid-Ask", depositedUsd: 2_500, valueUsd: 2_471.03, baseAmount: 0.724, quoteAmount: 0, unclaimedFeesUsd: 0.0, unclaimedBase: 0, unclaimedQuote: 0, openedDaysAgo: 4 },
  { id: "pos-0c4d", poolId: "usdc-usdt-damm-1", depositedUsd: 5_000, valueUsd: 5_018.4, baseAmount: 2_511.9, quoteAmount: 2_506.5, unclaimedFeesUsd: 7.81, unclaimedBase: 3.92, unclaimedQuote: 3.89, openedDaysAgo: 41 },
  { id: "pos-e512", poolId: "uni-usdc-dlmm-50", lowerBinOffset: -8, upperBinOffset: 8, shape: "Spot", depositedUsd: 1_200, valueUsd: 1_266.15, baseAmount: 81.2, quoteAmount: 623.0, unclaimedFeesUsd: 23.07, unclaimedBase: 1.47, unclaimedQuote: 11.42, openedDaysAgo: 9 },
];
