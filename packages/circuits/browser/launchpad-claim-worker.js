import { groth16 } from "snarkjs";

const hex = (value) => BigInt(value).toString(16).padStart(64, "0");

self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    self.postMessage({ id, stage: "loading-manifest" });
    const response = await fetch(data.manifestPath, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("LAUNCHPAD_PROVER_MANIFEST_UNAVAILABLE");
    const manifest = await response.json();
    if (manifest.feature !== "launchpad-proof-claim" || manifest.publicInputs !== 15) {
      throw new Error("LAUNCHPAD_PROVER_MANIFEST_INVALID");
    }
    self.postMessage({ id, stage: "loading-artifacts" });
    self.postMessage({ id, stage: "generating-witness" });
    self.postMessage({ id, stage: "proving" });
    const { proof, publicSignals } = await groth16.fullProve(
      data.input,
      manifest.assets.wasm.path,
      manifest.assets.zkey.path,
    );
    const encoded = `0x${hex(proof.pi_a[0])}${hex(proof.pi_a[1])}`
      + `${hex(proof.pi_b[0][1])}${hex(proof.pi_b[0][0])}`
      + `${hex(proof.pi_b[1][1])}${hex(proof.pi_b[1][0])}`
      + `${hex(proof.pi_c[0])}${hex(proof.pi_c[1])}`;
    self.postMessage({ id, stage: "complete", proof: encoded, publicInputs: publicSignals });
  } catch (reason) {
    const message = reason instanceof Error && /^LAUNCHPAD_[A-Z0-9_]+$/u.test(reason.message)
      ? reason.message
      : "LAUNCHPAD_PROVER_FAILED";
    self.postMessage({ id, error: message });
  }
};
