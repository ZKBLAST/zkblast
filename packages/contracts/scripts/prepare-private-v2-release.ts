import {
  readFile,
  mkdir,
  mkdtemp,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { sealPrivateProverV2 } from "@zkblast/config";

// READ-ONLY RPC + LOCAL STAGING ONLY. No wallet client, signing key or broadcast API.
const root = path.resolve(import.meta.dirname, "../../..");
const circuitTarget = path.join(root, "packages/circuits/target/v2-testnet");
let phase = "runtime";
const sha = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
type ArtifactInfo = {
  wasmSha256: string;
  provingKeySha256: string;
  verificationKeySha256: string;
  solidityVerifierSha256: string;
};

async function main() {
  check(
    process.env.APP_ENV === "testnet" && process.env.CHAIN_ID === "46630",
    "V2_STAGING_REQUIRES_TESTNET",
  );
  check(process.env.RPC_URL, "TESTNET_RPC_REQUIRED");
  const manifest = await loadDeploymentManifestFile(
    path.join(root, "deployments/testnet/manifest.json"),
    { environment: "testnet", chainId: 46630 },
  );
  const client = createPublicClient({
    transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
  });
  phase = "read-only-rpc";
  check(
    (await client.getChainId()) === manifest.chainId,
    "V2_RPC_CHAIN_MISMATCH",
  );
  phase = "upgrader-governance-resolution";
  const migration = JSON.parse(
    await readFile(
      path.join(
        root,
        "deployments/testnet/permissionless-factory-upgrade.json",
      ),
      "utf8",
    ),
  ) as {
    environment: string;
    chainId: number;
    complete: boolean;
    timelock: Address;
    governor: Address;
    proxy: Address;
    timelockRuntimeHash: Hex;
  };
  check(
    migration.environment === "testnet" &&
      migration.chainId === manifest.chainId &&
      migration.complete &&
      migration.governor.toLowerCase() ===
        manifest.roles.defaultAdmin.toLowerCase() &&
      migration.proxy.toLowerCase() ===
        manifest.integration.poolFactory.toLowerCase(),
    "TIMELOCK_MIGRATION_EVIDENCE_MISMATCH",
  );
  const upgrader = getAddress(migration.timelock);
  const timelockCode = await client.getCode({ address: upgrader });
  check(
    timelockCode && keccak256(timelockCode) === migration.timelockRuntimeHash,
    "TIMELOCK_CODE_HASH_MISMATCH",
  );
  check(
    (await client.readContract({
      address: upgrader,
      abi: parseAbi(["function getMinDelay() view returns (uint256)"]),
      functionName: "getMinDelay",
    })) === 300n,
    "TIMELOCK_NOT_FIVE_MINUTES",
  );
  check(
    await client.readContract({
      address: getAddress(manifest.integration.poolFactory),
      abi: parseAbi(["function hasRole(bytes32,address) view returns (bool)"]),
      functionName: "hasRole",
      args: [
        keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
        upgrader,
      ],
    }),
    "FACTORY_TIMELOCK_ROLE_NOT_CONFIRMED",
  );
  phase = "local-artifacts";
  const { run } = JSON.parse(
    await readFile(path.join(circuitTarget, "last-run.json"), "utf8"),
  ) as { run: string };
  check(/^run-[A-Za-z0-9_-]+$/u.test(run), "INVALID_V2_LOCAL_RUN");
  const directory = path.join(circuitTarget, run);
  const release = JSON.parse(
    await readFile(path.join(directory, "release.local.json"), "utf8"),
  ) as {
    environment: string;
    schemaVersion: number;
    eligibleForDeployment: boolean;
    artifacts: Record<"action" | "fund", ArtifactInfo>;
  };
  check(
    release.environment === "testnet" && release.schemaVersion === 2,
    "INVALID_V2_SOURCE_RELEASE",
  );
  const evidence = JSON.parse(
    await readFile(
      path.join(directory, "real-proof-results.local.json"),
      "utf8",
    ),
  ) as { positive: number; alteredPublicInputsRejected: number };
  check(
    evidence.positive >= 11 && evidence.alteredPublicInputsRejected >= 11,
    "V2_REAL_PROOF_EVIDENCE_REQUIRED",
  );
  const deployer = getAddress(manifest.deployerAddress);
  phase = "pending-nonce";
  const nonce = await client.getTransactionCount({
    address: deployer,
    blockTag: "pending",
  });
  const names = [
    "ActionGroth16V2",
    "FundGroth16V2",
    "PrivateActionVerifierV2",
    "PrivateFundVerifierV2",
    "Poseidon2FieldHasherV2",
    "PrivateVaultV2",
    "PrivateVaultV2Proxy",
  ] as const;
  const predicted = Object.fromEntries(
    names.map((name, offset) => [
      name,
      getContractAddress({ from: deployer, nonce: BigInt(nonce + offset) }),
    ]),
  ) as Record<(typeof names)[number], Address>;
  check(
    predicted.PrivateVaultV2Proxy.toLowerCase() !==
      manifest.shielded?.vault.toLowerCase(),
    "V2_VAULT_MUST_BE_ISOLATED",
  );
  const refresh = process.argv[2];
  check(
    !refresh || /^browser-stage-[A-Za-z0-9_-]+$/u.test(refresh),
    "INVALID_REFRESH_STAGE",
  );
  const output = refresh
    ? path.join(circuitTarget, refresh)
    : await mkdtemp(path.join(circuitTarget, "browser-stage-"));
  if (refresh) {
    const prior = JSON.parse(
      await readFile(path.join(output, "staging.json"), "utf8"),
    ) as {
      observedPendingNonce: number;
      predicted: { PrivateVaultV2Proxy: string };
    };
    check(
      prior.observedPendingNonce === nonce &&
        prior.predicted.PrivateVaultV2Proxy.toLowerCase() ===
          predicted.PrivateVaultV2Proxy.toLowerCase(),
      "REFRESH_STAGE_NONCE_CHANGED",
    );
  }
  phase = "staging-public-artifacts";
  const publicDirectory = path.join(output, "public/zk/testnet/v2");
  await mkdir(publicDirectory, { recursive: true });
  const asset = async (source: string, name: string, expected?: string) => {
    const contents = await readFile(source);
    const digest = sha(contents);
    check(
      !expected || digest === expected,
      "V2_STAGING_ARTIFACT_HASH_MISMATCH",
    );
    await copyFile(source, path.join(publicDirectory, name));
    return { path: `/zk/testnet/v2/${name}`, sha256: digest };
  };
  const bundles = {} as Record<
    "action" | "fund",
    {
      wasm: Awaited<ReturnType<typeof asset>>;
      zkey: Awaited<ReturnType<typeof asset>>;
      verificationKey: Awaited<ReturnType<typeof asset>>;
    }
  >;
  const verifiers = [];
  for (const kind of ["action", "fund"] as const) {
    const info = release.artifacts[kind];
    const verifier = await readFile(
      path.join(directory, `${kind}-verifier.sol`),
    );
    check(
      sha(verifier) === info.solidityVerifierSha256,
      "V2_VERIFIER_SOURCE_HASH_MISMATCH",
    );
    const artifactFile = path.join(
      root,
      "packages/contracts/out",
      kind === "action" ? "ActionGroth16.local.sol" : "FundGroth16.local.sol",
      "Groth16Verifier.json",
    );
    const artifact = JSON.parse(await readFile(artifactFile, "utf8")) as {
      bytecode: { object: Hex };
      deployedBytecode: { object: Hex };
    };
    verifiers.push({
      kind,
      sourceSha256: sha(verifier),
      creationBytecodeHash: keccak256(artifact.bytecode.object),
      runtimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
    });
    bundles[kind] = {
      wasm: await asset(
        path.join(directory, `${kind}_js/${kind}.wasm`),
        `${kind}.wasm`,
        info.wasmSha256,
      ),
      zkey: await asset(
        path.join(directory, `${kind}-testnet.zkey`),
        `${kind}.zkey`,
        info.provingKeySha256,
      ),
      verificationKey: await asset(
        path.join(directory, `${kind}-vkey.json`),
        `${kind}-vkey.json`,
        info.verificationKeySha256,
      ),
    };
  }
  const build = JSON.parse(
    await readFile(path.join(directory, "build.json"), "utf8"),
  ) as { circuits: Record<string, { wasmSha256: string }> };
  const noteCircuit = build.circuits["spend-vector"];
  check(noteCircuit, "V2_NOTE_CALCULATOR_INVENTORY_MISSING");
  const noteCalculator = await asset(
    path.join(directory, "spend-vector_js/spend-vector.wasm"),
    "note.wasm",
    noteCircuit.wasmSha256,
  );
  const sealed = await sealPrivateProverV2(
    {
      schemaVersion: 2,
      environment: "testnet",
      chainId: String(manifest.chainId),
      settlement: predicted.PrivateVaultV2Proxy,
      treeVersion: "2",
      trustModel: "single-operator-testnet",
      noteCalculator,
      action: { kind: "action", publicInputs: 32, assets: bundles.action },
      fund: { kind: "fund", publicInputs: 11, assets: bundles.fund },
    },
    "/zk/testnet/v2/manifest.json",
  );
  await writeFile(
    path.join(publicDirectory, "manifest.json"),
    sealed.serialized,
  );
  const staging = {
    schemaVersion: 2,
    environment: "testnet",
    chainId: manifest.chainId,
    activationAllowed: false,
    broadcastAllowed: false,
    deploymentVerified: false,
    sourceEligibleForDeployment: release.eligibleForDeployment,
    explanation:
      "Candidate only. Predicted addresses require unchanged nonce and exact deployment order; no active manifest is updated. Fork/gas rehearsal and bounded broadcast approval remain mandatory.",
    deployer,
    observedPendingNonce: nonce,
    predicted,
    registry: manifest.integration.poolRegistry,
    admin: manifest.roles.defaultAdmin,
    upgrader,
    upgraderResolution: {
      manifestUpgrader: manifest.roles.upgrader,
      migratedTimelock: upgrader,
      delaySeconds: 300,
      runtimeCodeHash: migration.timelockRuntimeHash,
      factoryRoleVerified: true,
      activeManifestChanged: false,
    },
    verifiers,
    reference: sealed.reference,
    required: [
      "compiled-source provenance",
      "fork/gas simulation",
      "deployment approval",
      "actual code/initializer/role verification",
      "asset configuration",
      "v1 regression and owner browser acceptance",
    ],
  };
  await writeFile(
    path.join(output, "staging.json"),
    `${JSON.stringify(staging, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      stagedDirectory: path.relative(root, output),
      activationAllowed: false,
      transactionsBroadcast: 0,
      liveConfigurationsChanged: 0,
      gasEstimate: "pending-fork-rehearsal",
    }),
  );
}
void main().catch((error: unknown) => {
  console.error(
    `V2_RELEASE_STAGING_FAILED (${phase}): ${error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "UNAVAILABLE"}; no broadcast was attempted.`,
  );
  process.exitCode = 1;
});
