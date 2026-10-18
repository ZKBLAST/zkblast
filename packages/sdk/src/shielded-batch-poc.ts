/**
 * Non-production research model for shielded batched-intent clearing.
 *
 * This module deliberately performs no proof verification and moves no assets.
 * It exists to make clearing, fee, expiry, replay, and refund semantics executable
 * before a circuit public-input schema or custody contract is approved.
 */

const BPS_DENOMINATOR = 10_000n;

export type ResearchIntent = Readonly<{
  nullifier: `0x${string}`;
  inputAsset: `0x${string}`;
  outputAsset: `0x${string}`;
  amountIn: bigint;
  minimumAmountOut: bigint;
  maximumFeeBps: bigint;
  deadline: bigint;
}>;

export type ClearingTerms = Readonly<{
  batchId: `0x${string}`;
  clearingPriceNumerator: bigint;
  clearingPriceDenominator: bigint;
  feeBps: bigint;
  settledAt: bigint;
}>;

export type IntentFill = Readonly<{
  nullifier: `0x${string}`;
  grossInput: bigint;
  feeInput: bigint;
  netInput: bigint;
  output: bigint;
}>;

export type BatchPreview = Readonly<{
  batchId: `0x${string}`;
  inputAsset: `0x${string}`;
  outputAsset: `0x${string}`;
  totalInput: bigint;
  totalFees: bigint;
  totalNetInput: bigint;
  totalOutput: bigint;
  roundingRemainderNumerator: bigint;
  fills: readonly IntentFill[];
}>;

export type IntentDisposition = "settled" | "refunded";

export class BatchIntentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchIntentValidationError";
  }
}

function assertPositive(value: bigint, field: string): void {
  if (value <= 0n)
    throw new BatchIntentValidationError(`${field} must be positive`);
}

function assertHex(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) {
    throw new BatchIntentValidationError(
      `${field} must be non-empty hexadecimal data`,
    );
  }
}

export function previewResearchBatch(
  intents: readonly ResearchIntent[],
  terms: ClearingTerms,
): BatchPreview {
  if (intents.length < 2) {
    throw new BatchIntentValidationError(
      "a research batch requires at least two intents",
    );
  }
  assertHex(terms.batchId, "batchId");
  assertPositive(terms.clearingPriceNumerator, "clearingPriceNumerator");
  assertPositive(terms.clearingPriceDenominator, "clearingPriceDenominator");
  if (terms.feeBps < 0n || terms.feeBps > BPS_DENOMINATOR) {
    throw new BatchIntentValidationError(
      "feeBps is outside the supported range",
    );
  }

  const first = intents[0]!;
  const seen = new Set<string>();
  let totalInput = 0n;
  let totalFees = 0n;
  let totalNetInput = 0n;
  let totalOutput = 0n;
  let roundingRemainderNumerator = 0n;

  const fills = intents.map((intent): IntentFill => {
    assertHex(intent.nullifier, "nullifier");
    assertPositive(intent.amountIn, "amountIn");
    if (intent.minimumAmountOut < 0n) {
      throw new BatchIntentValidationError(
        "minimumAmountOut cannot be negative",
      );
    }
    if (intent.maximumFeeBps < 0n || intent.maximumFeeBps > BPS_DENOMINATOR) {
      throw new BatchIntentValidationError(
        "maximumFeeBps is outside the supported range",
      );
    }
    if (intent.inputAsset.toLowerCase() !== first.inputAsset.toLowerCase()) {
      throw new BatchIntentValidationError(
        "all intents must use the same input asset",
      );
    }
    if (intent.outputAsset.toLowerCase() !== first.outputAsset.toLowerCase()) {
      throw new BatchIntentValidationError(
        "all intents must use the same output asset",
      );
    }
    if (intent.inputAsset.toLowerCase() === intent.outputAsset.toLowerCase()) {
      throw new BatchIntentValidationError(
        "input and output assets must differ",
      );
    }
    if (terms.settledAt > intent.deadline) {
      throw new BatchIntentValidationError("batch contains an expired intent");
    }
    if (terms.feeBps > intent.maximumFeeBps) {
      throw new BatchIntentValidationError(
        "batch fee exceeds an intent fee bound",
      );
    }

    const normalizedNullifier = intent.nullifier.toLowerCase();
    if (seen.has(normalizedNullifier)) {
      throw new BatchIntentValidationError(
        "batch contains a duplicate nullifier",
      );
    }
    seen.add(normalizedNullifier);

    const feeInput = (intent.amountIn * terms.feeBps) / BPS_DENOMINATOR;
    const netInput = intent.amountIn - feeInput;
    const outputNumerator = netInput * terms.clearingPriceNumerator;
    const output = outputNumerator / terms.clearingPriceDenominator;
    if (output < intent.minimumAmountOut) {
      throw new BatchIntentValidationError(
        "clearing output violates minimumAmountOut",
      );
    }

    totalInput += intent.amountIn;
    totalFees += feeInput;
    totalNetInput += netInput;
    totalOutput += output;
    roundingRemainderNumerator +=
      outputNumerator % terms.clearingPriceDenominator;

    return {
      nullifier: intent.nullifier,
      grossInput: intent.amountIn,
      feeInput,
      netInput,
      output,
    };
  });

  return {
    batchId: terms.batchId,
    inputAsset: first.inputAsset,
    outputAsset: first.outputAsset,
    totalInput,
    totalFees,
    totalNetInput,
    totalOutput,
    roundingRemainderNumerator,
    fills,
  };
}

export class ResearchIntentLedger {
  readonly #dispositions = new Map<string, IntentDisposition>();

  disposition(nullifier: `0x${string}`): IntentDisposition | undefined {
    return this.#dispositions.get(nullifier.toLowerCase());
  }

  settle(
    intents: readonly ResearchIntent[],
    terms: ClearingTerms,
  ): BatchPreview {
    for (const intent of intents) this.#assertUnspent(intent.nullifier);
    const preview = previewResearchBatch(intents, terms);
    for (const intent of intents)
      this.#dispositions.set(intent.nullifier.toLowerCase(), "settled");
    return preview;
  }

  refund(intent: ResearchIntent, refundedAt: bigint): void {
    this.#assertUnspent(intent.nullifier);
    if (refundedAt <= intent.deadline) {
      throw new BatchIntentValidationError(
        "intent cannot be refunded before its deadline",
      );
    }
    this.#dispositions.set(intent.nullifier.toLowerCase(), "refunded");
  }

  #assertUnspent(nullifier: `0x${string}`): void {
    if (this.disposition(nullifier)) {
      throw new BatchIntentValidationError(
        "intent is already settled or refunded",
      );
    }
  }
}
