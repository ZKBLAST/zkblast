import {
  fetchPrivatePerpsRelease,
  type PrivatePerpsConfig,
  type PrivatePerpsReleaseIndex,
} from "@zkblast/config";
import { encodeAbiParameters, type Hex } from "viem";

type Kind = keyof PrivatePerpsReleaseIndex["actions"];
type Proof = Readonly<{
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
}>;
type Result = Readonly<{ proof: Proof; publicSignals: readonly string[] }>;

export function encodePrivatePerpsProof({ proof }: Result): Hex {
  return encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [
      [BigInt(proof.pi_a[0]!), BigInt(proof.pi_a[1]!)],
      [
        [BigInt(proof.pi_b[0]![1]!), BigInt(proof.pi_b[0]![0]!)],
        [BigInt(proof.pi_b[1]![1]!), BigInt(proof.pi_b[1]![0]!)],
      ],
      [BigInt(proof.pi_c[0]!), BigInt(proof.pi_c[1]!)],
    ],
  );
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadPrivatePerpsRelease(
  environment: "testnet" | "mainnet",
  chainId: number,
  config: PrivatePerpsConfig,
): Promise<PrivatePerpsReleaseIndex> {
  return fetchPrivatePerpsRelease({
    environment,
    chainId: String(chainId),
    adapter: config.shieldedAdapter,
  }, config.proverRelease);
}

export function calculatePrivatePerpsPosition(
  release: PrivatePerpsReleaseIndex,
  environment: "testnet" | "mainnet",
  input: Readonly<Record<string, string>>,
): Promise<Readonly<{ commitment: string; nullifier: string }>> {
  const worker = new Worker("/zk/perps-position-worker.js");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); };
    const fail = (code: string) => { cleanup(); reject(new Error(code)); };
    const timeout = setTimeout(() => fail("PERPS_POSITION_CALCULATOR_TIMEOUT"), 30_000);
    worker.onerror = () => fail("PERPS_POSITION_CALCULATOR_FAILED");
    worker.onmessage = ({ data }: MessageEvent<{
      id: string; error?: string; commitment?: string; nullifier?: string;
    }>) => {
      if (data.id !== id) return;
      if (data.error || !data.commitment || !data.nullifier) return fail(data.error ?? "PERPS_POSITION_CALCULATOR_FAILED");
      cleanup();
      resolve({ commitment: data.commitment, nullifier: data.nullifier });
    };
    worker.postMessage({ id, input, environment, asset: release.positionCalculator });
  });
}

export async function provePrivatePerpsInBrowser(
  input: Readonly<{
    environment: "testnet" | "mainnet";
    chainId: number;
    config: PrivatePerpsConfig;
    release: PrivatePerpsReleaseIndex;
    kind: Kind;
    witness: Readonly<Record<string, unknown>>;
    expectedPublicInputs: readonly string[];
  }>,
  options: Readonly<{
    signal?: AbortSignal;
    onStage?: (stage: "proving" | "verifying") => void;
  }> = {},
): Promise<Result> {
  const action = input.release.actions[input.kind];
  const response = await fetch(action.manifestPath, {
    credentials: "omit", redirect: "error", signal: options.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("PERPS_ACTION_MANIFEST_UNAVAILABLE");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 32_768 || await sha256(bytes) !== action.manifestSha256) {
    throw new Error("PERPS_ACTION_MANIFEST_HASH_MISMATCH");
  }
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (options.signal?.aborted) throw new Error("PERPS_PROVER_CANCELLED");
  const worker = new Worker("/zk/perps-v1-worker.js");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const fail = (code: string) => { cleanup(); reject(new Error(code)); };
    const cancel = () => fail("PERPS_PROVER_CANCELLED");
    const timeout = setTimeout(() => fail("PERPS_PROVER_TIMEOUT"), 180_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => fail("PERPS_PROVER_WORKER_FAILED");
    worker.onmessage = ({ data }: MessageEvent<{
      id: string; error?: string; stage?: string; proof?: Proof; publicSignals?: readonly string[];
    }>) => {
      if (data.id !== id) return;
      if (data.error) return fail(data.error);
      if (data.stage === "proving" || data.stage === "verifying") options.onStage?.(data.stage);
      if (data.stage !== "complete") return;
      if (!data.proof || !data.publicSignals) return fail("PERPS_PROVER_RESULT_INVALID");
      cleanup();
      resolve({ proof: data.proof, publicSignals: data.publicSignals });
    };
    worker.postMessage({
      id,
      kind: input.kind,
      input: input.witness,
      expectedPublicInputs: input.expectedPublicInputs,
      manifest,
      scope: {
        environment: input.environment,
        chainId: String(input.chainId),
        adapter: input.config.shieldedAdapter,
      },
    });
  });
}
