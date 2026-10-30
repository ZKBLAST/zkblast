const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const counts = { open: 21, close: 17, modify: 19, "claim-liquidated": 16 };
const digest = /^[a-f0-9]{64}$/u;

/** Browser-only witness proving with hash-pinned, environment-scoped Perps assets. */
export async function provePrivatePerps(request, { groth16, fetchAsset, sha256, onStage }) {
  const { kind, input, expectedPublicInputs, manifest, scope } = request;
  const count = counts[kind];
  if (
    !count || !scope || !["testnet", "mainnet"].includes(scope.environment) ||
    !/^[1-9][0-9]*$/u.test(scope.chainId) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(scope.adapter) || BigInt(scope.adapter) === 0n ||
    manifest?.schemaVersion !== 1 || manifest.feature !== "shielded-perps" ||
    manifest.kind !== kind || manifest.publicInputs !== count ||
    manifest.environment !== scope.environment || manifest.chainId !== scope.chainId ||
    manifest.adapter?.toLowerCase() !== scope.adapter.toLowerCase()
  ) throw new Error("PERPS_PROVER_SCOPE_MISMATCH");
  const canonical = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value) < FIELD;
  if (!Array.isArray(expectedPublicInputs) || expectedPublicInputs.length !== count || !expectedPublicInputs.every(canonical))
    throw new Error("INVALID_PERPS_PUBLIC_INPUTS");
  let inputAdapter;
  try {
    inputAdapter = BigInt(String(input?.adapter));
  } catch {
    throw new Error("PERPS_PROVER_INPUT_SCOPE_MISMATCH");
  }
  if (
    expectedPublicInputs[0] !== "1" || expectedPublicInputs[2] !== scope.chainId ||
    expectedPublicInputs[3] !== String(BigInt(scope.adapter)) ||
    String(input?.chain_id) !== scope.chainId || inputAdapter !== BigInt(scope.adapter)
  ) throw new Error("PERPS_PROVER_INPUT_SCOPE_MISMATCH");

  const load = async (asset) => {
    const prefix = `/zk/${scope.environment}/perps-v1/`;
    if (!asset || !digest.test(asset.sha256) || !asset.path.startsWith(prefix) || !/^\/zk\/(testnet|mainnet)\/perps-v1\/[a-zA-Z0-9_.-]+$/u.test(asset.path))
      throw new Error("INVALID_PERPS_PROVER_ASSET");
    const data = await fetchAsset(asset.path);
    if ((await sha256(data)) !== asset.sha256) throw new Error("PERPS_PROVER_ASSET_HASH_MISMATCH");
    return new Uint8Array(data);
  };
  const [wasm, zkey, verificationKey] = await Promise.all([
    load(manifest.assets?.wasm), load(manifest.assets?.zkey), load(manifest.assets?.verificationKey),
  ]);
  const vkey = JSON.parse(new TextDecoder().decode(verificationKey));
  if (vkey.protocol !== "groth16" || vkey.curve !== "bn128" || vkey.nPublic !== count)
    throw new Error("PERPS_VERIFICATION_KEY_MISMATCH");
  onStage("proving");
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
  if (publicSignals.length !== count || publicSignals.some((value, index) => value !== expectedPublicInputs[index]))
    throw new Error("PERPS_GENERATED_STATEMENT_MISMATCH");
  onStage("verifying");
  if (!(await groth16.verify(vkey, publicSignals, proof))) throw new Error("PERPS_GENERATED_PROOF_INVALID");
  return { proof, publicSignals };
}
