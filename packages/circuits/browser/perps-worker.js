import { groth16 } from "snarkjs";
import { provePrivatePerps } from "./perps-prover.mjs";

let busy = false;

function failureCode(reason) {
  const message = reason instanceof Error ? reason.message : "";
  if (/^PERPS_[A-Z0-9_]+$/u.test(message)) return message;
  if (/Assert Failed|Input signal|witness/i.test(message)) return "PERPS_WITNESS_GENERATION_FAILED";
  if (/memory|allocation/i.test(message)) return "PERPS_PROVER_MEMORY_FAILED";
  return "PERPS_PROVER_RUNTIME_FAILED";
}

self.onmessage = async ({ data }) => {
  const { id } = data;
  if (busy) return self.postMessage({ id, error: "PERPS_PROVER_BUSY" });
  busy = true;
  try {
    const result = await provePrivatePerps(data, {
      groth16,
      fetchAsset: async (path) => {
        const response = await fetch(path, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error("PERPS_PROVER_ASSET_UNAVAILABLE");
        return response.arrayBuffer();
      },
      sha256: async (bytes) => Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join(""),
      onStage: (stage) => self.postMessage({ id, stage }),
    });
    self.postMessage({ id, stage: "complete", ...result });
  } catch (reason) {
    console.error("Private Perps prover failed", reason);
    self.postMessage({ id, error: failureCode(reason) });
  } finally {
    busy = false;
  }
};
