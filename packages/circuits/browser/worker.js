import { groth16 } from "snarkjs";

self.onmessage = async ({ data }) => {
  if (data !== "run") return;
  try {
    self.postMessage({ stage: "loading-assets" });
    const input = await fetch("/assets/input.json").then((response) =>
      response.json(),
    );
    self.postMessage({ stage: "proving" });
    const startedAt = performance.now();
    const { proof, publicSignals } = await groth16.fullProve(
      input,
      "/assets/benchmark.wasm",
      "/assets/circuit-final.zkey",
    );
    const elapsedMs = performance.now() - startedAt;
    self.postMessage({ stage: "verifying", elapsedMs });
    const verificationKey = await fetch("/assets/verification-key.json").then(
      (response) => response.json(),
    );
    const valid = await groth16.verify(verificationKey, publicSignals, proof);
    self.postMessage({
      candidate: "circom-groth16",
      elapsedMs,
      proofBytes: JSON.stringify(proof).length,
      valid,
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.stack : String(error),
    });
  }
};
