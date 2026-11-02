import { SdkError } from "./errors.js";

export type LinearCurve = Readonly<{
  initialPriceX18: bigint;
  slopeX18: bigint;
  saleCapacityX18: bigint;
}>;

const WAD = 10n ** 18n;

export function linearCurvePreview(
  curve: LinearCurve,
  pointCount = 16,
): readonly Readonly<{ progressBps: number; priceX18: bigint }>[] {
  if (
    curve.initialPriceX18 <= 0n ||
    curve.saleCapacityX18 <= 0n ||
    pointCount < 2 ||
    pointCount > 100
  ) {
    throw new SdkError(
      "INVALID_QUOTE",
      "Linear curve preview input is invalid",
    );
  }
  return Array.from({ length: pointCount }, (_, index) => {
    const soldX18 =
      (curve.saleCapacityX18 * BigInt(index)) / BigInt(pointCount - 1);
    return {
      progressBps: Math.round((index * 10_000) / (pointCount - 1)),
      priceX18: curve.initialPriceX18 + (curve.slopeX18 * soldX18) / WAD,
    };
  });
}

/** Mirrors BondingCurveMath.linearIntegral for SDK/API quote preflight. */
export function linearCurveQuote(
  curve: LinearCurve,
  soldX18: bigint,
  baseAmountX18: bigint,
  roundUp: boolean,
): bigint {
  if (
    soldX18 < 0n ||
    baseAmountX18 <= 0n ||
    soldX18 + baseAmountX18 > curve.saleCapacityX18 ||
    curve.initialPriceX18 <= 0n
  ) {
    throw new SdkError(
      "INVALID_QUOTE",
      "Linear curve quote input is outside capacity",
    );
  }
  const startPrice = curve.initialPriceX18 + (curve.slopeX18 * soldX18) / WAD;
  const endPrice =
    curve.initialPriceX18 + (curve.slopeX18 * (soldX18 + baseAmountX18)) / WAD;
  const numerator = baseAmountX18 * (startPrice + endPrice);
  const denominator = 2n * WAD;
  const result = numerator / denominator;
  return roundUp && numerator % denominator !== 0n ? result + 1n : result;
}
