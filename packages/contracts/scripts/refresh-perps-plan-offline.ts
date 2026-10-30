import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { keccak256, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const artifactRoot = path.join(root, "packages/contracts/out");
const artifacts = [
  "OpenGroth16", "CloseGroth16", "ModifyGroth16", "ClaimGroth16",
  "PrivatePerpOpenVerifier", "PrivatePerpCloseVerifier", "PrivatePerpModifyVerifier", "PrivatePerpClaimVerifier",
  "PerpMarketRegistry", "ChainlinkOracleAdapter", "FundingRateModule", "PerpEngine",
  "InsuranceFund", "LiquidityVaultUSDG", "ShieldedPerpAdapter", "ERC1967Proxy",
] as const;
const sourceFile = (name: string) => name.startsWith("PrivatePerp")
  ? "PrivatePerpProofVerifiers"
  : name;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

for (const environment of ["testnet", "mainnet"] as const) {
  const planPath = path.join(root, `deployments/${environment}/perps-v1-plan.json`);
  const plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
  if (plan.environment !== environment || plan.authorization === undefined) {
    throw new Error(`PERPS_PLAN_INVALID_${environment}`);
  }
  const sourceArtifacts: Record<string, { creationBytecodeHash: Hex; runtimeBytecodeHash: Hex }> = {};
  for (const name of artifacts) {
    const artifact = JSON.parse(
      await readFile(path.join(artifactRoot, `${sourceFile(name)}.sol`, `${name}.json`), "utf8"),
    ) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
    if (artifact.bytecode.object === "0x" || artifact.deployedBytecode.object === "0x") {
      throw new Error(`PERPS_ARTIFACT_EMPTY_${name}`);
    }
    sourceArtifacts[name] = {
      creationBytecodeHash: keccak256(artifact.bytecode.object),
      runtimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
    };
  }
  const circuitSetup = JSON.parse(await readFile(
    path.join(root, "packages/circuits/target/perps-v1-candidate-5/setup-report.json"), "utf8",
  ));
  const refreshed = {
    ...plan,
    sourceArtifacts,
    circuitSetup,
    validationMode: "offline-artifacts",
    authorization: { broadcastAllowed: false, activeManifestChanged: false },
  };
  const serialized = `${JSON.stringify(refreshed, null, 2)}\n`;
  await writeFile(planPath, serialized);
  console.log(`${environment} ${artifacts.length} artifacts ${sha256(Buffer.from(serialized))}`);
}
