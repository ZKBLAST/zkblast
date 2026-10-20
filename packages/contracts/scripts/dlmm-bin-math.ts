const SCALE = 10n ** 18n;
const MIN_BIN = -10_000;
const MAX_BIN = 10_000;

function mulDiv(left: bigint, right: bigint, denominator: bigint) {
  return (left * right) / denominator;
}

function powX18(baseX18: bigint, exponent: number) {
  let result = SCALE;
  let base = baseX18;
  let remaining = exponent;
  while (remaining !== 0) {
    if ((remaining & 1) !== 0) result = mulDiv(result, base, SCALE);
    remaining >>= 1;
    if (remaining !== 0) base = mulDiv(base, base, SCALE);
  }
  return result;
}

export function priceFromBin(binId: number, binStepBps: number) {
  if (!Number.isInteger(binId) || binId < MIN_BIN || binId > MAX_BIN)
    throw new Error("DLMM_BIN_OUT_OF_RANGE");
  if (!Number.isInteger(binStepBps) || binStepBps < 1 || binStepBps > 1_000)
    throw new Error("DLMM_BIN_STEP_INVALID");
  const baseX18 = SCALE + BigInt(binStepBps) * 10n ** 14n;
  return binId >= 0
    ? powX18(baseX18, binId)
    : mulDiv(SCALE, SCALE, powX18(baseX18, -binId));
}

function decimalX18(value: string) {
  if (!/^\d+(?:\.\d{1,18})?$/u.test(value))
    throw new Error("DLMM_REFERENCE_PRICE_INVALID");
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
}

export function rawPriceX18(
  token1PerToken0: string,
  token0Decimals: number,
  token1Decimals: number,
) {
  if (
    !Number.isInteger(token0Decimals) ||
    !Number.isInteger(token1Decimals) ||
    token0Decimals < 0 ||
    token1Decimals < 0 ||
    token0Decimals > 36 ||
    token1Decimals > 36
  )
    throw new Error("DLMM_TOKEN_DECIMALS_INVALID");
  const numerator = decimalX18(token1PerToken0) * 10n ** BigInt(token1Decimals);
  const result = numerator / 10n ** BigInt(token0Decimals);
  if (result === 0n) throw new Error("DLMM_RAW_PRICE_UNDERFLOW");
  return result;
}

export function nearestBin(targetPriceX18: bigint, binStepBps: number) {
  if (targetPriceX18 <= 0n) throw new Error("DLMM_REFERENCE_PRICE_INVALID");
  if (
    targetPriceX18 < priceFromBin(MIN_BIN, binStepBps) ||
    targetPriceX18 > priceFromBin(MAX_BIN, binStepBps)
  )
    throw new Error("DLMM_REFERENCE_PRICE_OUT_OF_RANGE");

  let low = MIN_BIN;
  let high = MAX_BIN;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (priceFromBin(middle, binStepBps) < targetPriceX18) low = middle + 1;
    else high = middle;
  }
  const upper = low;
  const lower = Math.max(MIN_BIN, upper - 1);
  const lowerPrice = priceFromBin(lower, binStepBps);
  const upperPrice = priceFromBin(upper, binStepBps);
  return targetPriceX18 - lowerPrice <= upperPrice - targetPriceX18
    ? lower
    : upper;
}

export function initialBinForHumanPrice(
  token1PerToken0: string,
  token0Decimals: number,
  token1Decimals: number,
  binStepBps: number,
) {
  const targetPriceX18 = rawPriceX18(
    token1PerToken0,
    token0Decimals,
    token1Decimals,
  );
  const binId = nearestBin(targetPriceX18, binStepBps);
  const binPriceX18 = priceFromBin(binId, binStepBps);
  const deviationBps = Number(
    (binPriceX18 > targetPriceX18
      ? (binPriceX18 - targetPriceX18) * 10_000n
      : (targetPriceX18 - binPriceX18) * 10_000n) / targetPriceX18,
  );
  return { binId, targetPriceX18, binPriceX18, deviationBps } as const;
}
