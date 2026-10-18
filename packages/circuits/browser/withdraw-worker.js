import { groth16 } from "snarkjs";

let verificationKeyPromise;

self.onmessage = async ({ data }) => {
  const { id, input } = data;
  try {
    self.postMessage({ id, stage: "proving" });
    const { proof, publicSignals } = await groth16.fullProve(
      input,
      "/zk/withdraw.wasm",
      "/zk/withdraw-v1-final.zkey",
    );
    self.postMessage({ id, stage: "verifying" });
    verificationKeyPromise ??= fetch("/zk/withdraw-verification-key.json").then(
      (response) => {
        if (!response.ok) throw new Error("WITHDRAW_VERIFICATION_KEY_UNAVAILABLE");
        return response.json();
      },
    );
    if (!(await groth16.verify(await verificationKeyPromise, publicSignals, proof)))
      throw new Error("GENERATED_PROOF_FAILED_LOCAL_VERIFICATION");
    self.postMessage({ id, stage: "complete", proof, publicSignals });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
