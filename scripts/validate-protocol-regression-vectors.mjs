import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SCALE = 10n ** 18n;
const FEE_DENOMINATOR = 1_000_000n;
const vectorUrl = new URL(
  "../data/protocol-regression-vectors.json",
  import.meta.url,
);
const vectors = JSON.parse(await readFile(vectorUrl, "utf8"));

function divideRoundingUp(numerator, denominator) {
  assert(denominator > 0n, "denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}

function quoteExactInput(vector) {
  const amountIn = BigInt(vector.amountIn);
  const reserveIn = BigInt(vector.reserveIn);
  const reserveOut = BigInt(vector.reserveOut);
  const feePips = BigInt(vector.feePips);
  const fee = divideRoundingUp(amountIn * feePips, FEE_DENOMINATOR);
  const netAmountIn = amountIn - fee;
  const amountOut = (netAmountIn * reserveOut) / (reserveIn + netAmountIn);
  return amountOut === 0n || amountOut >= reserveOut
    ? { error: "INSUFFICIENT_LIQUIDITY", fee }
    : { amountOut, fee };
}

function quoteExactOutput(vector) {
  const amountOut = BigInt(vector.amountOut);
  const reserveIn = BigInt(vector.reserveIn);
  const reserveOut = BigInt(vector.reserveOut);
  const feePips = BigInt(vector.feePips);
  const netAmountIn = divideRoundingUp(
    reserveIn * amountOut,
    reserveOut - amountOut,
  );
  const amountIn = divideRoundingUp(
    netAmountIn * FEE_DENOMINATOR,
    FEE_DENOMINATOR - feePips,
  );
  return { amountIn, fee: amountIn - netAmountIn };
}

function priceFromBin(binId, binStepBps) {
  let base = SCALE + BigInt(binStepBps) * 10n ** 14n;
  let exponent = BigInt(Math.abs(binId));
  let result = SCALE;

  while (exponent !== 0n) {
    if ((exponent & 1n) !== 0n) result = (result * base) / SCALE;
    exponent >>= 1n;
    if (exponent !== 0n) base = (base * base) / SCALE;
  }

  return binId >= 0 ? result : (SCALE * SCALE) / result;
}

assert.equal(vectors.version, 1, "unsupported vector version");

for (const vector of vectors.dammExactInput) {
  const actual = quoteExactInput(vector);
  if (vector.expectedError) {
    assert.equal(actual.error, vector.expectedError, vector.name);
    continue;
  }
  assert.equal(
    actual.amountOut?.toString(),
    vector.expectedAmountOut,
    vector.name,
  );
  assert.equal(actual.fee.toString(), vector.expectedFee, vector.name);
}

for (const vector of vectors.dammExactOutput) {
  const actual = quoteExactOutput(vector);
  assert.equal(
    actual.amountIn.toString(),
    vector.expectedAmountIn,
    vector.name,
  );
  assert.equal(actual.fee.toString(), vector.expectedFee, vector.name);
}

for (const vector of vectors.dlmmPrices) {
  assert.equal(
    priceFromBin(vector.binId, vector.binStepBps).toString(),
    vector.expectedPriceX18,
    vector.name,
  );
}

console.log(
  `Protocol regression vectors passed: ${vectors.dammExactInput.length} DAMM exact-input, ${vectors.dammExactOutput.length} DAMM exact-output, ${vectors.dlmmPrices.length} DLMM price`,
);
