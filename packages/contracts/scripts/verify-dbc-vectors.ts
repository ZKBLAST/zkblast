import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type VectorFile = Readonly<{
  schemaVersion: number;
  scale: string;
  curve: Readonly<{
    initialPriceX18: string;
    slopeX18: string;
    saleCapacityX18: string;
  }>;
  vectors: readonly Readonly<{
    name: string;
    soldX18: string;
    baseAmountX18: string;
    quoteUpX18: string;
    quoteDownX18: string;
  }>[];
}>;

const directory = path.dirname(fileURLToPath(import.meta.url));
const vectorPath = path.resolve(directory, "../test-vectors/dbc/linear-v1.json");
const fixture = JSON.parse(await readFile(vectorPath, "utf8")) as VectorFile;

if (fixture.schemaVersion !== 1) throw new Error("UNSUPPORTED_DBC_VECTOR_SCHEMA");

const scale = BigInt(fixture.scale);
const initialPrice = BigInt(fixture.curve.initialPriceX18);
const slope = BigInt(fixture.curve.slopeX18);
const capacity = BigInt(fixture.curve.saleCapacityX18);

function price(sold: bigint) {
  return initialPrice + (slope * sold) / scale;
}

function integral(sold: bigint, amount: bigint, roundUp: boolean) {
  if (amount <= 0n || sold < 0n || sold + amount > capacity) {
    throw new Error("INVALID_DBC_VECTOR_INPUT");
  }
  const numerator = amount * (price(sold) + price(sold + amount));
  const denominator = 2n * scale;
  const quotient = numerator / denominator;
  return roundUp && numerator % denominator !== 0n ? quotient + 1n : quotient;
}

for (const vector of fixture.vectors) {
  const sold = BigInt(vector.soldX18);
  const amount = BigInt(vector.baseAmountX18);
  const up = integral(sold, amount, true);
  const down = integral(sold, amount, false);
  if (up !== BigInt(vector.quoteUpX18)) {
    throw new Error(`${vector.name}: quote-up mismatch`);
  }
  if (down !== BigInt(vector.quoteDownX18)) {
    throw new Error(`${vector.name}: quote-down mismatch`);
  }
}

console.log(`DBC vectors passed: ${fixture.vectors.length}`);
