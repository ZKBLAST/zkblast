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
      const listener = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        if (event.data.stage) onStage?.(event.data.stage);
        if (event.data.error) {
          this.#worker.removeEventListener("message", listener);
          reject(new Error(event.data.error));
        } else if (event.data.stage === "complete") {
          this.#worker.removeEventListener("message", listener);
          resolve({ proof: event.data.proof, publicInputs: event.data.publicInputs });
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
