import { SdkError } from "./errors.js";

export const POOL_PRICE_SCALE = 10n ** 18n;
const UINT256_MAX = 2n ** 256n - 1n;
export const MIN_DLMM_BIN = -10_000;
export const MAX_DLMM_BIN = 10_000;

export type PoolModel = "damm" | "dlmm";
export type PoolPriceKind = "pool" | "execution" | "oracle" | "reference";
export type PoolPriceView = "price" | "onchain-cap";
export type LiquidityShape = "spot" | "curve" | "bid-ask";
export type PairOrientation = Readonly<{
  baseAddress: string;
  quoteAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
  token0IsBase: boolean;
}>;

function addressKey(address: string): string {
  if (!/^0x[\da-f]{40}$/iu.test(address))
    throw new SdkError("INVALID_ADDRESS", `Invalid token address: ${address}`);
  return address.toLowerCase();
}

function decimals(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 36)
    throw new SdkError("INVALID_DECIMALS", "Token decimals must be from 0 to 36");
  return value;
}

export function pairOrientation(input: {
  baseAddress: string;
  quoteAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
}): PairOrientation {
  const baseAddress = addressKey(input.baseAddress);
  const quoteAddress = addressKey(input.quoteAddress);
  if (baseAddress === quoteAddress)
    throw new SdkError("INVALID_PAIR", "Pool tokens must be different");
  return {
    baseAddress,
    quoteAddress,
    baseDecimals: decimals(input.baseDecimals),
    quoteDecimals: decimals(input.quoteDecimals),
    token0IsBase: baseAddress < quoteAddress,
  };
}

function mulDiv(value: bigint, multiplier: bigint, denominator: bigint): bigint {
  if (value < 0n || multiplier < 0n || denominator <= 0n)
    throw new SdkError("INVALID_POOL_MATH", "mulDiv inputs are outside the supported domain");
  const result = (value * multiplier) / denominator;
  if (result > UINT256_MAX)
    throw new SdkError("INVALID_POOL_MATH", "Pool math exceeds uint256");
  return result;
}

function powX18(baseX18: bigint, exponent: number): bigint {
  let result = POOL_PRICE_SCALE;
  let base = baseX18;
  let remaining = exponent;
  while (remaining !== 0) {
    if ((remaining & 1) !== 0)
      result = mulDiv(result, base, POOL_PRICE_SCALE);
    remaining >>= 1;
    if (remaining !== 0) base = mulDiv(base, base, POOL_PRICE_SCALE);
  }
  return result;
}

/** Exact bigint port of BinPriceMath.priceFromBin. */
export function priceFromBin(binId: number, binStepBps: number): bigint {
  if (!Number.isInteger(binStepBps) || binStepBps <= 0 || binStepBps > 1_000)
    throw new SdkError("INVALID_BIN_STEP", "Bin step must be from 1 to 1,000 bps");
  if (!Number.isInteger(binId) || binId < MIN_DLMM_BIN || binId > MAX_DLMM_BIN)
    throw new SdkError("BIN_OUT_OF_RANGE", "DLMM bin must be from -10,000 to 10,000");
  const baseX18 = POOL_PRICE_SCALE + BigInt(binStepBps) * 10n ** 14n;
  if (binId >= 0) return powX18(baseX18, binId);
  return mulDiv(POOL_PRICE_SCALE, POOL_PRICE_SCALE, powX18(baseX18, -binId));
}

/** Greatest bin whose encoded price is less than or equal to the target. */
export function binFromPrice(priceX18: bigint, binStepBps: number): number {
  if (priceX18 <= 0n)
    throw new SdkError("INVALID_PRICE", "Pool price must be positive");
  if (priceX18 < priceFromBin(MIN_DLMM_BIN, binStepBps)) return MIN_DLMM_BIN;
  if (priceX18 >= priceFromBin(MAX_DLMM_BIN, binStepBps)) return MAX_DLMM_BIN;
  let low = MIN_DLMM_BIN;
  let high = MAX_DLMM_BIN;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (priceFromBin(middle, binStepBps) <= priceX18) low = middle;
    else high = middle - 1;
  }
  return low;
}

function scaleByDecimals(value: bigint, exponent: number): bigint {
  if (exponent === 0) return value;
  const factor = 10n ** BigInt(Math.abs(exponent));
  return exponent > 0 ? value * factor : value / factor;
}

/** Convert token1/token0 raw price to human quote-per-base X18. */
export function quotePerBaseX18(
  token1PerToken0X18: bigint,
  orientation: PairOrientation,
): bigint {
  if (token1PerToken0X18 <= 0n)
    throw new SdkError("INVALID_PRICE", "Pool price must be positive");
  const oriented = orientation.token0IsBase
    ? token1PerToken0X18
    : mulDiv(POOL_PRICE_SCALE, POOL_PRICE_SCALE, token1PerToken0X18);
  return scaleByDecimals(
    oriented,
    orientation.baseDecimals - orientation.quoteDecimals,
  );
}

export function poolPriceView(stockTokenPair: boolean): PoolPriceView {
  return stockTokenPair ? "price" : "onchain-cap";
}

export function onchainCapX18(
  quotePerTokenX18: bigint,
  circulatingSupplyRaw: bigint,
  baseDecimals: number,
): bigint {
  if (quotePerTokenX18 < 0n || circulatingSupplyRaw < 0n)
    throw new SdkError("INVALID_POOL_MATH", "Price and supply cannot be negative");
  return mulDiv(
    quotePerTokenX18,
    circulatingSupplyRaw,
    10n ** BigInt(decimals(baseDecimals)),
  );
}

const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

export function formatPoolPrice(value: number, maximumDigits = 6): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0";
  if (value >= 0.0001)
    return value.toLocaleString("en-US", { maximumSignificantDigits: maximumDigits });
  const zeros = Math.max(0, Math.floor(-Math.log10(value)) - 1);
  const subscript = String(zeros)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)])
    .join("");
  const significant = value * 10 ** (zeros + 1);
  return `0.0${subscript}${significant.toLocaleString("en-US", {
    maximumSignificantDigits: maximumDigits,
  })}`;
}

export function formatCompactQuote(value: number, unit = ""): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const tiers = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const;
  const tier = tiers.find(([threshold]) => absolute >= threshold);
  const formatted = tier
    ? `${(value / tier[0]).toLocaleString("en-US", { maximumFractionDigits: 2 })}${tier[1]}`
    : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Deterministic preview weights. Execution remains governed by pool capabilities. */
export function liquidityShapeWeights(
  shape: LiquidityShape,
  binCount: number,
): readonly bigint[] {
  if (!Number.isInteger(binCount) || binCount <= 0 || binCount > 256)
    throw new SdkError("INVALID_BIN_COUNT", "Preview bin count must be from 1 to 256");
  const middle = (binCount - 1) / 2;
  return Array.from({ length: binCount }, (_, index) => {
    if (shape === "spot") return 1n;
    const distance = Math.abs(index - middle);
    if (shape === "curve")
      return BigInt(Math.max(1, Math.round((middle + 1 - distance) * 1_000)));
    return BigInt(Math.max(1, Math.round((distance + 1) * 1_000)));
  });
}

export function allocateByWeights(
  amount: bigint,
  weights: readonly bigint[],
): readonly bigint[] {
  if (amount < 0n || weights.length === 0 || weights.some((weight) => weight <= 0n))
    throw new SdkError("INVALID_ALLOCATION", "Allocation inputs are invalid");
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  let allocated = 0n;
  return weights.map((weight, index) => {
    const share = index === weights.length - 1
      ? amount - allocated
      : mulDiv(amount, weight, total);
    allocated += share;
    return share;
  });
}
