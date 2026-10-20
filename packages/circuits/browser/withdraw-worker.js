import { groth16 } from "snarkjs";
import {
  sha256Hex,
  validateProverManifest,
  fetchProverManifest,
} from "../../config/src/shielded-prover.ts";
import testnetRelease from "./testnet-prover-release.json";

async function verifiedAsset(asset) {
  const response = await fetch(asset.path, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("PROVER_ASSET_UNAVAILABLE");
  const bytes = await response.arrayBuffer();
  if ((await sha256Hex(bytes)) !== asset.sha256)
    throw new Error("PROVER_ASSET_INTEGRITY_FAILED");
  return new Uint8Array(bytes);
}

self.onmessage = async ({ data }) => {
  const { id, input } = data;
  try {
    // Cached legacy clients may omit a release, but only testnet can use this compatibility path.
    const network = data.network ?? {
      environment: "testnet",
      chainId: Number(input.chain_id),
    };
    const manifest =
      data.manifest ??
      (network.environment === "testnet" && network.chainId === 46630
        ? await fetchProverManifest(network, testnetRelease)
        : null);
    const release = validateProverManifest(manifest, network);
    if (String(input.chain_id) !== String(network.chainId))
      throw new Error("PROVER_INPUT_CHAIN_MISMATCH");
    const [wasm, zkey, verificationKey] = await Promise.all([
      verifiedAsset(release.assets.wasm),
      verifiedAsset(release.assets.zkey),
      verifiedAsset(release.assets.verificationKey),
    ]);
    self.postMessage({ id, stage: "proving" });
    const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
    self.postMessage({ id, stage: "verifying" });
    if (
      !(await groth16.verify(
        JSON.parse(new TextDecoder().decode(verificationKey)),
        publicSignals,
        proof,
      ))
    )
      throw new Error("GENERATED_PROOF_FAILED_LOCAL_VERIFICATION");
    self.postMessage({ id, stage: "complete", proof, publicSignals });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
