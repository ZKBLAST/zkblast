import type { NoteScopeV2 } from "./notecrypto-v2";

type Asset = Readonly<{
  path: string;
  sha256: string;
  parts?: readonly Readonly<{ path: string; sha256: string }>[];
}>;
export type PrivateProverManifestV2 = NoteScopeV2 &
  Readonly<{
    schemaVersion: 2;
    kind: "action" | "fund";
    publicInputs: 32 | 11;
    assets: Readonly<{ wasm: Asset; zkey: Asset; verificationKey: Asset }>;
  }>;

type Proof = Readonly<{
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
}>;
export type PrivateProofV2 = Readonly<{
  proof: Proof;
  publicSignals: readonly string[];
}>;

/** Witnesses are sent only to a same-origin worker, never to the API. */
export function proveInBrowserV2(
  request: Readonly<{
    kind: "action" | "fund";
    scope: NoteScopeV2;
    manifest: PrivateProverManifestV2;
    input: Readonly<Record<string, unknown>>;
    expectedPublicInputs: readonly string[];
  }>,
  options: Readonly<{
    signal?: AbortSignal;
    onStage?: (stage: "proving" | "verifying") => void;
  }> = {},
): Promise<PrivateProofV2> {
  if (options.signal?.aborted)
    return Promise.reject(new Error("V2_PROVER_CANCELLED"));
  const worker = new Worker("/zk/private-v2-worker.js");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const fail = (code: string) => {
      cleanup();
      reject(new Error(code));
    };
    const cancel = () => fail("V2_PROVER_CANCELLED");
    const timeout = setTimeout(() => fail("V2_PROVER_TIMEOUT"), 180_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => fail("V2_PROVER_WORKER_FAILED");
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      id: string;
      error?: string;
      stage?: string;
      proof?: Proof;
      publicSignals?: readonly string[];
    }>) => {
      if (data.id !== id) return;
      if (data.error) {
        fail("V2_PROVER_FAILED");
        return;
      }
      if (data.stage === "proving" || data.stage === "verifying")
        options.onStage?.(data.stage);
      if (data.stage !== "complete") return;
      if (
        !data.proof ||
        !data.publicSignals ||
        data.publicSignals.length !== request.expectedPublicInputs.length ||
        data.publicSignals.some(
          (value, index) => value !== request.expectedPublicInputs[index],
        )
      ) {
        fail("V2_PROVER_STATEMENT_MISMATCH");
        return;
      }
      cleanup();
      resolve({ proof: data.proof, publicSignals: data.publicSignals });
    };
    try {
      worker.postMessage({ ...request, id });
    } catch {
      fail("V2_PROVER_REQUEST_FAILED");
    }
  });
}
