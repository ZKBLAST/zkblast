export type LiquidationCandidate = Readonly<{
  positionId: `0x${string}`;
  observedBlock: bigint;
  observedAtMs: number;
}>;

export type LiquidationAttempt = Readonly<{
  attempts: number;
  pendingTxHash?: `0x${string}`;
  retryAfterMs: number;
}>;

export type LiquidationCoordinatorOptions = Readonly<{
  maximumAttempts: number;
  observationMaximumAgeMs: number;
  retryDelayMs: number;
}>;

/**
 * Process-local idempotency boundary for Perps liquidation submissions.
 * Canonical eligibility must still be re-read from the engine before signing.
 */
export class LiquidationCoordinator {
  readonly #attempts = new Map<`0x${string}`, LiquidationAttempt>();
  readonly #options: LiquidationCoordinatorOptions;

  constructor(options: LiquidationCoordinatorOptions) {
    if (
      options.maximumAttempts < 1 ||
      options.observationMaximumAgeMs < 1 ||
      options.retryDelayMs < 1
    ) {
      throw new Error("Invalid liquidation coordinator options");
    }
    this.#options = options;
  }

  canSubmit(candidate: LiquidationCandidate, nowMs: number): boolean {
    if (candidate.observedAtMs > nowMs) return false;
    if (nowMs - candidate.observedAtMs > this.#options.observationMaximumAgeMs) return false;
    const current = this.#attempts.get(candidate.positionId);
    if (!current) return true;
    if (current.pendingTxHash) return false;
    return current.attempts < this.#options.maximumAttempts && nowMs >= current.retryAfterMs;
  }

  markSubmitted(
    positionId: `0x${string}`,
    transactionHash: `0x${string}`,
    nowMs: number,
  ): void {
    const current = this.#attempts.get(positionId);
    this.#attempts.set(positionId, {
      attempts: (current?.attempts ?? 0) + 1,
      pendingTxHash: transactionHash,
      retryAfterMs: nowMs + this.#options.retryDelayMs,
    });
  }

  markFailed(positionId: `0x${string}`, nowMs: number): void {
    const current = this.#attempts.get(positionId);
    if (!current) return;
    this.#attempts.set(positionId, {
      attempts: current.attempts,
      retryAfterMs: nowMs + this.#options.retryDelayMs,
    });
  }

  markFinalized(positionId: `0x${string}`): void {
    this.#attempts.delete(positionId);
  }

  attempt(positionId: `0x${string}`): LiquidationAttempt | undefined {
    return this.#attempts.get(positionId);
  }
}
