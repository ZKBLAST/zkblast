import { parseTokenAmount } from "@zkblast/sdk";

export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("NEGATIVE_SQUARE_ROOT");
  if (value < 2n) return value;
  let root = value,
    next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
}
export function liquidityAmounts(input: {
  amount: string;
  seedAmount: string;
  decimals0: number;
  decimals1: number;
  slippageBps: number;
  state:
    | { reserve0: string; reserve1: string; totalShares: string }
    | undefined
    | null;
  minimumLockedLiquidity?: string;
}) {
  try {
    if (!input.state || ![10, 50, 100].includes(input.slippageBps)) return null;
    const amount0 = parseTokenAmount(input.amount, input.decimals0);
    const reserve0 = BigInt(input.state.reserve0),
      reserve1 = BigInt(input.state.reserve1),
      supply = BigInt(input.state.totalShares);
    if (amount0 <= 0n) return null;
    const amount1 =
      supply > 0n && reserve0 > 0n
        ? (amount0 * reserve1) / reserve0
        : parseTokenAmount(input.seedAmount, input.decimals1);
    if (amount1 <= 0n) return null;
    let shares: bigint;
    if (supply === 0n) {
      if (!input.minimumLockedLiquidity) return null;
      shares =
        integerSqrt(amount0 * amount1) - BigInt(input.minimumLockedLiquidity);
    } else {
      if (reserve0 <= 0n || reserve1 <= 0n) return null;
      const first = (amount0 * supply) / reserve0,
        second = (amount1 * supply) / reserve1;
      shares = first < second ? first : second;
    }
    const minimumShares = (shares * BigInt(10000 - input.slippageBps)) / 10000n;
    return minimumShares > 0n ? { amount0, amount1, minimumShares } : null;
  } catch {
    return null;
  }
}
