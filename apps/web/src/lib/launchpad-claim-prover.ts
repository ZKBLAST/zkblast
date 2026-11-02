export type LaunchpadClaimProofStage =
  | "loading-manifest"
  | "loading-artifacts"
  | "generating-witness"
  | "proving"
  | "complete";

export type LaunchpadClaimProofRequest = Readonly<{
  input: Record<string, string>;
  manifestPath: string;
}>;

export type LaunchpadClaimProofResult = Readonly<{
  proof: `0x${string}`;
  publicInputs: readonly string[];
}>;

const proofStages = new Set<LaunchpadClaimProofStage>([
  "loading-manifest",
  "loading-artifacts",
  "generating-witness",
  "proving",
  "complete",
]);

function workerMessage(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  return {
    id: typeof message.id === "number" ? message.id : null,
    stage:
      typeof message.stage === "string"
        && proofStages.has(message.stage as LaunchpadClaimProofStage)
        ? (message.stage as LaunchpadClaimProofStage)
        : null,
    error: typeof message.error === "string" ? message.error : null,
    proof:
      typeof message.proof === "string" && /^0x[\da-f]+$/iu.test(message.proof)
        ? (message.proof as `0x${string}`)
        : null,
    publicInputs:
      Array.isArray(message.publicInputs)
        && message.publicInputs.every((input) => typeof input === "string")
        ? message.publicInputs
        : null,
  };
}

export class LaunchpadClaimProver {
  readonly #worker: Worker;
  #sequence = 0;

  constructor(workerPath = "/zk/launchpad-claim-v1-worker.js") {
    this.#worker = new Worker(workerPath);
  }

  prove(
    request: LaunchpadClaimProofRequest,
    onStage?: (stage: LaunchpadClaimProofStage) => void,
  ): Promise<LaunchpadClaimProofResult> {
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const listener = (event: MessageEvent<unknown>) => {
        const message = workerMessage(event.data);
        if (!message || message.id !== id) return;
        if (message.stage) onStage?.(message.stage);
        if (message.error) {
          this.#worker.removeEventListener("message", listener);
          reject(new Error(message.error));
        } else if (message.stage === "complete") {
          this.#worker.removeEventListener("message", listener);
          if (!message.proof || !message.publicInputs) {
            reject(new Error("LAUNCHPAD_CLAIM_PROOF_RESPONSE_INVALID"));
            return;
          }
          resolve({ proof: message.proof, publicInputs: message.publicInputs });
        }
      };
      this.#worker.addEventListener("message", listener);
      this.#worker.postMessage({ id, ...request });
    });
  }

  close() {
    this.#worker.terminate();
  }
}
