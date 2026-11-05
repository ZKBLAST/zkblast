import { formatUnits, parseUnits } from "viem";

import { SdkError } from "./errors.js";

export const BASIS_POINTS = 10_000n;
export const X18 = 10n ** 18n;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new SdkError(
      "INVALID_DECIMALS",
      "Token decimals must be an integer from 0 to 255",
    );
  }
}

function assertBps(slippageBps: number): bigint {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  ) {
    throw new SdkError(
      "INVALID_SLIPPAGE",
      "Slippage must be an integer from 0 to 10,000 bps",
    );
  }
  return BigInt(slippageBps);
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  try {
    const amount = parseUnits(value, decimals);
    if (amount < 0n) throw new Error("negative");
    return amount;
  } catch (cause) {
    throw new SdkError(
      "INVALID_AMOUNT",
      `Invalid token amount: ${value}`,
      cause,
    );
  }
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (value < 0n)
    throw new SdkError("INVALID_AMOUNT", "Token amount cannot be negative");
  return formatUnits(value, decimals);
}

export function tokenRawToX18(value: bigint, decimals: number): bigint {
  assertDecimals(decimals);
  if (value < 0n)
    throw new SdkError("INVALID_AMOUNT", "Token amount cannot be negative");
  if (decimals > 18)
    throw new SdkError(
      "INVALID_DECIMALS",
      "X18 normalization supports token decimals up to 18",
    );
  return value * 10n ** BigInt(18 - decimals);
}

export function x18ToTokenRaw(
  valueX18: bigint,
  decimals: number,
  rounding: "down" | "up" = "down",
): bigint {
  assertDecimals(decimals);
  if (valueX18 < 0n)
    throw new SdkError("INVALID_AMOUNT", "X18 amount cannot be negative");
  if (decimals > 18)
    throw new SdkError(
      "INVALID_DECIMALS",
      "X18 normalization supports token decimals up to 18",
    );
  const scale = 10n ** BigInt(18 - decimals);
  const quotient = valueX18 / scale;
  return rounding === "up" && valueX18 % scale !== 0n
    ? quotient + 1n
    : quotient;
}

export function minimumAmountOut(
  quotedAmount: bigint,
  slippageBps: number,
): bigint {
  if (quotedAmount < 0n)
    throw new SdkError("INVALID_AMOUNT", "Quote cannot be negative");
  return (
    (quotedAmount * (BASIS_POINTS - assertBps(slippageBps))) / BASIS_POINTS
  );
}

export function maximumAmountIn(
  quotedAmount: bigint,
  slippageBps: number,
): bigint {
  if (quotedAmount < 0n)
    throw new SdkError("INVALID_AMOUNT", "Quote cannot be negative");
  const numerator = quotedAmount * (BASIS_POINTS + assertBps(slippageBps));
  return (numerator + BASIS_POINTS - 1n) / BASIS_POINTS;
}

export function deadlineFromNow(
  nowSeconds: number,
  ttlSeconds: number,
): bigint {
  if (
    !Number.isInteger(nowSeconds) ||
    !Number.isInteger(ttlSeconds) ||
    nowSeconds < 0 ||
    ttlSeconds <= 0
  ) {
    throw new SdkError(
      "INVALID_DEADLINE",
      "Deadline inputs must be positive integer seconds",
    );
  }
  return BigInt(nowSeconds + ttlSeconds);
}
