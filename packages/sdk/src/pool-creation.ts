import { parseUnits } from "viem";

const scale = 10n ** 18n;
const maxUint256 = (1n << 256n) - 1n;
function mulDiv(a: bigint, b: bigint) {
  const value = (a * b) / scale;
  if (value > maxUint256) throw new Error("BIN_PRICE_OVERFLOW");
  return value;
}
export function binPriceX18(bin: number, step: number): bigint {
  if (
    !Number.isInteger(bin) ||
    Math.abs(bin) > 10000 ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 1000
  )
    throw new Error("INVALID_BIN_CONFIGURATION");
  let base = scale + BigInt(step) * 10n ** 14n;
  let exponent = Math.abs(bin);
  let result = scale;
  while (exponent) {
    if (exponent & 1) result = mulDiv(result, base);
    exponent >>= 1;
    if (exponent) base = mulDiv(base, base);
  }
  const price = bin < 0 ? (scale * scale) / result : result;
  if (price === 0n) throw new Error("BIN_PRICE_UNREPRESENTABLE");
  return price;
}

/** Initial human price is token B per token A, before canonical address sorting. */
export function initialBinForPrice(
  price: string,
  decimals0: number,
  decimals1: number,
  aIsToken0: boolean,
  step: number,
) {
  if (
    !/^\d+(?:\.\d{1,18})?$/u.test(price) ||
    ![decimals0, decimals1].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 36,
    )
  )
    throw new Error("INVALID_INITIAL_PRICE");
  const human = parseUnits(price, 18);
  if (human <= 0n) throw new Error("INVALID_INITIAL_PRICE");
  let raw = aIsToken0 ? human : (scale * scale) / human;
  raw = (raw * 10n ** BigInt(decimals1)) / 10n ** BigInt(decimals0);
  if (raw <= 0n || step < 1 || step > 1000)
    throw new Error("INITIAL_PRICE_UNREPRESENTABLE");
  const estimate = Math.log(Number(raw) / 1e18) / Math.log1p(step / 10000);
  if (!Number.isFinite(estimate) || Math.abs(estimate) > 10000)
    throw new Error("INITIAL_PRICE_OUTSIDE_BIN_RANGE");
  const bin = Math.round(estimate);
  const represented = binPriceX18(bin, step);
  return { bin, priceX18: represented.toString() };
}
