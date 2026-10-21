import { groth16 } from "snarkjs";
import { provePrivateV2 } from "./private-v2-prover.mjs";

let busy = false;
self.onmessage = async ({ data }) => {
  const { id } = data;
  if (busy) {
    self.postMessage({ id, error: "V2_PROVER_BUSY" });
    return;
  }
  busy = true;
  try {
    const result = await provePrivateV2(data, {
      groth16,
      fetchAsset: async (path) => {
        const response = await fetch(path, {
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error("V2_PROVER_ASSET_UNAVAILABLE");
        return response.arrayBuffer();
      },
      sha256: async (bytes) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (value) => value.toString(16).padStart(2, "0"),
        ).join(""),
      onStage: (stage) => self.postMessage({ id, stage }),
    });
    self.postMessage({ id, stage: "complete", ...result });
  } catch {
    // Never send witness values or third-party exception details back to telemetry/UI.
    self.postMessage({ id, error: "V2_PROVER_FAILED" });
  } finally {
    busy = false;
  }
};
