import assert from "node:assert/strict";
import test from "node:test";

import {
  BatchIntentValidationError,
  ResearchIntentLedger,
  previewResearchBatch,
  type ClearingTerms,
  type ResearchIntent,
} from "../src/index.js";

const inputAsset = "0x1000000000000000000000000000000000000001" as const;
const outputAsset = "0x2000000000000000000000000000000000000002" as const;

function intent(
  index: number,
  overrides: Partial<ResearchIntent> = {},
): ResearchIntent {
  return {
    nullifier: `0x${index.toString(16).padStart(64, "0")}`,
    inputAsset,
    outputAsset,
    amountIn: 10_000n,
    minimumAmountOut: 19_800n,
    maximumFeeBps: 100n,
    deadline: 1_000n,
    ...overrides,
  };
}

const terms: ClearingTerms = {
  batchId: "0x01",
  clearingPriceNumerator: 2n,
  clearingPriceDenominator: 1n,
  feeBps: 100n,
  settledAt: 900n,
};

test("clears a uniform pair with bounded fees and conservative rounding", () => {
  const result = previewResearchBatch([intent(1), intent(2)], terms);
  assert.equal(result.totalInput, 20_000n);
  assert.equal(result.totalFees, 200n);
  assert.equal(result.totalNetInput, 19_800n);
  assert.equal(result.totalOutput, 39_600n);
  assert.equal(result.fills.length, 2);
});

test("rejects expired, excessive-fee, slippage, mixed-pair, and duplicate intents", () => {
  const invalidCases: Array<readonly ResearchIntent[]> = [
    [intent(1, { deadline: 899n }), intent(2)],
    [intent(1, { maximumFeeBps: 99n }), intent(2)],
    [intent(1, { minimumAmountOut: 19_801n }), intent(2)],
    [intent(1), intent(2, { outputAsset: inputAsset })],
    [intent(1), intent(1)],
  ];

  for (const intents of invalidCases) {
    assert.throws(
      () => previewResearchBatch(intents, terms),
      BatchIntentValidationError,
    );
  }
});

test("failed settlement is atomic and leaves every intent refundable", () => {
  const ledger = new ResearchIntentLedger();
  const first = intent(1);
  const second = intent(2, { minimumAmountOut: 20_000n });

  assert.throws(
    () => ledger.settle([first, second], terms),
    BatchIntentValidationError,
  );
  assert.equal(ledger.disposition(first.nullifier), undefined);
  assert.equal(ledger.disposition(second.nullifier), undefined);
  ledger.refund(first, 1_001n);
  assert.equal(ledger.disposition(first.nullifier), "refunded");
});

test("settlement and refund are mutually exclusive replay paths", () => {
  const ledger = new ResearchIntentLedger();
  const first = intent(1);
  const second = intent(2);

  ledger.settle([first, second], terms);
  assert.equal(ledger.disposition(first.nullifier), "settled");
  assert.throws(
    () => ledger.settle([first, second], terms),
    BatchIntentValidationError,
  );
  assert.throws(() => ledger.refund(first, 1_001n), BatchIntentValidationError);

  const expired = intent(3);
  ledger.refund(expired, 1_001n);
  assert.throws(
    () => ledger.settle([expired, intent(4)], terms),
    BatchIntentValidationError,
  );
});

test("refund is unavailable until strictly after the signed deadline", () => {
  const ledger = new ResearchIntentLedger();
  const pending = intent(1);
  assert.throws(
    () => ledger.refund(pending, 1_000n),
    BatchIntentValidationError,
  );
  assert.equal(ledger.disposition(pending.nullifier), undefined);
});
