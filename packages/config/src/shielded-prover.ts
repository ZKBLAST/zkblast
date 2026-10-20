export type ProverNetwork = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  proverTrustModel?: "experimental-single-operator";
}>;
export type ProverRelease = Readonly<{
  manifestPath: string;
  manifestSha256: string;
}>;
export type ProverAsset = Readonly<{ path: string; sha256: string }>;
export type ProverManifest = ProverNetwork &
  Readonly<{
    schemaVersion: 1;
    circuitVersion: 1;
    publicInputs: 13;
    trustModel:
      | "testnet-only"
      | "independent-ceremony-reviewed"
      | "experimental-single-operator";
    assets: Readonly<{
      wasm: ProverAsset;
      zkey: ProverAsset;
      verificationKey: ProverAsset;
    }>;
  }>;

const digestPattern = /^[a-f0-9]{64}$/u;
const networkChains = { testnet: 46630, mainnet: 4663 } as const;

export function assertProverNetwork(network: ProverNetwork): void {
  if (networkChains[network.environment] !== network.chainId)
    throw new Error("PROVER_NETWORK_MISMATCH");
}

function assertAsset(asset: ProverAsset, environment: string): void {
  if (
    !asset ||
    !digestPattern.test(asset.sha256) ||
    !new RegExp(
      `^/zk/${environment}/[a-zA-Z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)+$`,
      "u",
    ).test(asset.path)
  )
    throw new Error("PROVER_ASSET_INVALID");
}

export function validateProverManifest(
  input: unknown,
  network: ProverNetwork,
): ProverManifest {
  assertProverNetwork(network);
  const manifest = input as ProverManifest | null;
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.circuitVersion !== 1 ||
    manifest.publicInputs !== 13 ||
    manifest.environment !== network.environment ||
    manifest.chainId !== network.chainId
  )
    throw new Error("PROVER_MANIFEST_MISMATCH");
  const expectedTrust =
    network.environment === "mainnet"
      ? (network.proverTrustModel ?? "independent-ceremony-reviewed")
      : "testnet-only";
  if (manifest.trustModel !== expectedTrust)
    throw new Error("PROVER_TRUST_MODEL_MISMATCH");
  for (const kind of ["wasm", "zkey", "verificationKey"] as const)
    assertAsset(manifest.assets?.[kind], network.environment);
  return manifest;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function fetchProverManifest(
  network: ProverNetwork,
  release: ProverRelease,
): Promise<ProverManifest> {
  assertProverNetwork(network);
  if (
    !release ||
    !digestPattern.test(release.manifestSha256) ||
    !new RegExp(`^/zk/${network.environment}/[a-zA-Z0-9_-]+\\.json$`, "u").test(
      release.manifestPath,
    )
  )
    throw new Error("PROVER_RELEASE_UNAVAILABLE");
  const response = await fetch(release.manifestPath, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("PROVER_MANIFEST_UNAVAILABLE");
  const bytes = await response.arrayBuffer();
  if ((await sha256Hex(bytes)) !== release.manifestSha256)
    throw new Error("PROVER_MANIFEST_INTEGRITY_FAILED");
  return validateProverManifest(
    JSON.parse(new TextDecoder().decode(bytes)),
    network,
  );
}
