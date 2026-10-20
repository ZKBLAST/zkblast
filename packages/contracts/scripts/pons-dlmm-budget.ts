export type PonsFundingLimits = Readonly<{
  purchaseWethRaw: string;
  maximumUsdgRaw: string;
  slippageBps: number;
  maxFeePerGasWei: string;
  maxExecutionFeeWei: string;
}>;

function boundedInteger(value: string, maximum: bigint) {
  if (!/^\d+$/u.test(value)) return false;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= maximum;
}

export function validatePonsFundingLimits(limits: PonsFundingLimits) {
  if (
    !boundedInteger(limits.purchaseWethRaw, 10_000_000_000_000n) ||
    !boundedInteger(limits.maximumUsdgRaw, 30_000n) ||
    !Number.isInteger(limits.slippageBps) ||
    limits.slippageBps < 1 ||
    limits.slippageBps > 100 ||
    !boundedInteger(limits.maxFeePerGasWei, 60_312_000n) ||
    !boundedInteger(limits.maxExecutionFeeWei, 400_000_000_000_000n)
  )
    throw new Error("Funding configuration exceeds reviewed limits");
}

export function assertExecutionBudget(
  spent: bigint,
  gas: bigint,
  maxFee: bigint,
  cap: bigint,
) {
  if (
    spent < 0n ||
    gas <= 0n ||
    maxFee <= 0n ||
    cap <= 0n ||
    spent + gas * maxFee > cap
  )
    throw new Error("Execution budget exceeded");
}
