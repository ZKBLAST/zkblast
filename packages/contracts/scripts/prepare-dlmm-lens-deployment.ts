import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  getAddress,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
}>;
type Manifest = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  deployerAddress: Address;
  contracts: Record<string, unknown>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const supportedTargets = new Set([
  "testnet",
  "mainnet",
  "hyperevm-mainnet",
]);
const target = process.env.DEPLOYMENT_TARGET?.trim();
if (!target || !supportedTargets.has(target))
  throw new Error("DEPLOYMENT_TARGET must be testnet, mainnet or hyperevm-mainnet");
const nonceInput = process.env.STARTING_NONCE?.trim();
if (!nonceInput || !/^\d+$/u.test(nonceInput))
  throw new Error("STARTING_NONCE must be an explicit unsigned integer");
const startingNonce = BigInt(nonceInput);
if (startingNonce > BigInt(Number.MAX_SAFE_INTEGER))
  throw new Error("STARTING_NONCE exceeds the reviewed range");

const manifestPath = path.join(root, `deployments/${target}/manifest.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const expectedChain = target === "testnet" ? 46630 : target === "mainnet" ? 4663 : 999;
if (manifest.chainId !== expectedChain)
  throw new Error(`DLMM_LENS_CHAIN_MISMATCH:${manifest.chainId}:${expectedChain}`);
if (manifest.contracts.DlmmLens)
  throw new Error("DLMM_LENS_ALREADY_PRESENT_IN_MANIFEST");

const outDirectory = process.env.FOUNDRY_OUT?.trim() ||
  (target === "hyperevm-mainnet" ? "out-hyperevm" : "out");
const artifactPath = path.join(
  root,
  `packages/contracts/${outDirectory}/DlmmLens.sol/DlmmLens.json`,
);
const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
if (artifact.bytecode.object === "0x" || artifact.deployedBytecode.object === "0x")
  throw new Error("DLMM_LENS_ARTIFACT_EMPTY");

const deployer = getAddress(manifest.deployerAddress);
const predictedAddress = getContractAddress({ from: deployer, nonce: startingNonce });
const transaction = {
  index: 0,
  nonce: Number(startingNonce),
  contractName: "DlmmLens",
  predictedContractAddress: predictedAddress,
  data: artifact.bytecode.object,
  dataHash: keccak256(artifact.bytecode.object),
  value: "0",
};
const plan = {
  schemaVersion: 1,
  kind: "offline-dlmm-lens-deployment-plan",
  generatedAt: new Date().toISOString(),
  target,
  environment: manifest.environment,
  chainId: manifest.chainId,
  deployer,
  startingNonce: Number(startingNonce),
  nextNonce: Number(startingNonce + 1n),
  transactionCount: 1,
  predictedAddress,
  artifact: {
    creationBytecodeHash: keccak256(artifact.bytecode.object),
    runtimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
  },
  transaction,
  planSha256: "",
  gates: {
    privateKeysRead: false,
    rpcRead: false,
    broadcastAllowed: false,
    preflightRequired: true,
    explicitApprovalRequired: true,
  },
};
plan.planSha256 = createHash("sha256")
  .update(JSON.stringify(plan))
  .digest("hex");
const outputPath = path.join(
  root,
  `deployments/${target}/dlmm-lens-deployment-plan.json`,
);
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({
  target,
  chainId: manifest.chainId,
  predictedAddress,
  planSha256: plan.planSha256,
  outputPath: path.relative(root, outputPath),
  broadcastAllowed: false,
}, null, 2));
