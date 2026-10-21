const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const digestPattern = /^[a-f0-9]{64}$/u;

/** Dependency injection keeps worker protocol testable without exposing witness data to a server. */
export async function provePrivateV2(
  request,
  { groth16, fetchAsset, sha256, onStage },
) {
  const { kind, input, expectedPublicInputs, manifest, scope } = request;
  const count = kind === "action" ? 32 : kind === "fund" ? 11 : 0;
  if (
    !count ||
    !scope ||
    !(
      (scope.environment === "testnet" && scope.chainId === "46630") ||
      (scope.environment === "mainnet" && scope.chainId === "4663")
    ) ||
    !/^[1-9][0-9]*$/u.test(scope.chainId) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(scope.settlement) ||
    BigInt(scope.settlement) === 0n ||
    !/^[1-9][0-9]*$/u.test(scope.treeVersion) ||
    manifest?.schemaVersion !== 2 ||
    manifest.kind !== kind ||
    manifest.publicInputs !== count ||
    manifest.environment !== scope.environment ||
    manifest.chainId !== scope.chainId ||
    manifest.settlement?.toLowerCase() !== scope.settlement.toLowerCase() ||
    manifest.treeVersion !== scope.treeVersion
  )
    throw new Error("V2_PROVER_SCOPE_MISMATCH");
  const canonical = (value) =>
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,77})$/u.test(value) &&
    BigInt(value) < FIELD;
  if (
    !Array.isArray(expectedPublicInputs) ||
    expectedPublicInputs.length !== count ||
    !expectedPublicInputs.every(canonical)
  )
    throw new Error("INVALID_V2_PUBLIC_INPUTS");
  const context = kind === "action" ? [1, 2, 3] : [2, 3, 4];
  if (
    expectedPublicInputs[0] !== "2" ||
    expectedPublicInputs[context[0]] !== scope.chainId ||
    expectedPublicInputs[context[1]] !== String(BigInt(scope.settlement)) ||
    expectedPublicInputs[context[2]] !== scope.treeVersion ||
    String(input?.chain_id) !== scope.chainId ||
    String(input?.settlement) !== String(BigInt(scope.settlement)) ||
    String(input?.tree_version) !== scope.treeVersion
  )
    throw new Error("V2_PROVER_INPUT_SCOPE_MISMATCH");
  const load = async (asset) => {
    if (
      !asset ||
      !digestPattern.test(asset.sha256) ||
      !/^\/zk\/(testnet|mainnet)\/v2\/[a-zA-Z0-9_.-]+$/u.test(asset.path) ||
      !asset.path.startsWith(`/zk/${scope.environment}/v2/`)
    )
      throw new Error("INVALID_V2_PROVER_ASSET");
    const data = await fetchAsset(asset.path);
    if ((await sha256(data)) !== asset.sha256)
      throw new Error("V2_PROVER_ASSET_HASH_MISMATCH");
    return new Uint8Array(data);
  };
  const [wasm, zkey, verificationKey] = await Promise.all(
    ["wasm", "zkey", "verificationKey"].map((name) =>
      load(manifest.assets?.[name]),
    ),
  );
  const vkey = JSON.parse(new TextDecoder().decode(verificationKey));
  if (
    vkey.protocol !== "groth16" ||
    vkey.curve !== "bn128" ||
    vkey.nPublic !== count
  )
    throw new Error("V2_VERIFICATION_KEY_MISMATCH");
  onStage("proving");
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
  if (
    publicSignals.length !== count ||
    publicSignals.some((value, index) => value !== expectedPublicInputs[index])
  )
    throw new Error("V2_GENERATED_STATEMENT_MISMATCH");
  onStage("verifying");
  if (!(await groth16.verify(vkey, publicSignals, proof)))
    throw new Error("V2_GENERATED_PROOF_INVALID");
  return { proof, publicSignals };
}
