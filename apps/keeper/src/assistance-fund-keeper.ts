export type AssistanceExecutionCandidate = Readonly<{
  idempotencyKey: string;
  routeId: `0x${string}`;
  amountIn: bigint;
}>;

export type AssistanceSimulation =
  | Readonly<{ executable: false; retryable: boolean; reason: string }>
  | Readonly<{ executable: true; transaction: Readonly<Record<string, unknown>> }>;

export type AssistanceKeeperMetrics = Readonly<{
  discovered: number;
  simulated: number;
  submitted: number;
  retryable: number;
  failed: number;
}>;

export interface AssistanceKeeperPort {
  discover(): Promise<readonly AssistanceExecutionCandidate[]>;
  simulate(candidate: AssistanceExecutionCandidate): Promise<AssistanceSimulation>;
  pendingNonce(): Promise<number>;
  submit(
    transaction: Readonly<Record<string, unknown>>,
    nonce: number,
    mode: "initial" | "replacement",
  ): Promise<`0x${string}`>;
}

const retryableCodes = [
  "STALE_REFERENCE_PRICE",
  "INSUFFICIENT_OBSERVATIONS",
  "INSUFFICIENT_POOL_LIQUIDITY",
  "EXECUTION_LIMIT_EXCEEDED",
  "PRICE_DEVIATION_EXCEEDED",
  "NONCE_TOO_LOW",
  "REPLACEMENT_UNDERPRICED",
] as const;

export function isRetryableAssistanceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return retryableCodes.some((code) => message.toUpperCase().includes(code));
}

/** Server-only orchestration. Every candidate is simulated immediately before submission. */
export class AssistanceFundKeeper {
  private readonly completed = new Set<string>();
  private running = false;
  private counters = { discovered: 0, simulated: 0, submitted: 0, retryable: 0, failed: 0 };

  constructor(
    private readonly port: AssistanceKeeperPort,
    private readonly maximumExecutionsPerRun = 4,
  ) {
    if (maximumExecutionsPerRun < 1 || maximumExecutionsPerRun > 32)
      throw new Error("INVALID_KEEPER_LIMIT");
  }

  async runOnce(): Promise<readonly `0x${string}`[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const candidates = await this.port.discover();
      this.counters.discovered += candidates.length;
      const hashes: `0x${string}`[] = [];
      let nonce = await this.port.pendingNonce();
      for (const candidate of candidates) {
        if (hashes.length >= this.maximumExecutionsPerRun || this.completed.has(candidate.idempotencyKey)) continue;
        try {
          const simulation = await this.port.simulate(candidate);
          this.counters.simulated += 1;
          if (!simulation.executable) {
            this.counters[simulation.retryable ? "retryable" : "failed"] += 1;
            continue;
          }
          let hash: `0x${string}`;
          try {
            hash = await this.port.submit(simulation.transaction, nonce, "initial");
          } catch (error) {
            const message = error instanceof Error ? error.message.toUpperCase() : String(error).toUpperCase();
            if (message.includes("REPLACEMENT_UNDERPRICED")) {
              hash = await this.port.submit(simulation.transaction, nonce, "replacement");
            } else if (message.includes("NONCE_TOO_LOW")) {
              nonce = await this.port.pendingNonce();
              hash = await this.port.submit(simulation.transaction, nonce, "initial");
            } else throw error;
          }
          nonce += 1;
          hashes.push(hash);
          this.completed.add(candidate.idempotencyKey);
          this.counters.submitted += 1;
        } catch (error) {
          this.counters[isRetryableAssistanceError(error) ? "retryable" : "failed"] += 1;
        }
      }
      return hashes;
    } finally {
      this.running = false;
    }
  }

  metrics(): AssistanceKeeperMetrics {
    return { ...this.counters };
  }
}
