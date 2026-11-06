import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex } }>;
type Manifest = Readonly<{
  environment: "mainnet";
  chainId: 4663;
  deployerAddress: Address;
  governanceAddress: Address;
  upgraderAddress: Address;
  protectedLaunch: Readonly<{
    launchFactory: Address;
    identityRegistry: Address;
  }>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as Manifest;
if (manifest.environment !== "mainnet" || manifest.chainId !== 4663) {
  throw new Error("PROTECTED_FACTORY_RECOVERY_CONTEXT_INVALID");
}
const artifact = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/contracts/out-hyperevm/ProtectedLaunchFactory.sol/ProtectedLaunchFactory.json",
    ),
    "utf8",
  ),
) as Artifact;
if (!artifact.bytecode.object || artifact.bytecode.object === "0x") {
  throw new Error("PROTECTED_FACTORY_ARTIFACT_MISSING");
}

const rpcCandidates = [
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim()),
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
].filter((value): value is string => Boolean(value));
let client: ReturnType<typeof createPublicClient> | undefined;
for (const rpcUrl of new Set(rpcCandidates)) {
  const candidate = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 12_000 }),
  });
  try {
    if ((await candidate.getChainId()) === manifest.chainId) {
      client = candidate;
      break;
    }
  } catch {
    // Try the next configured/public RPC without exposing endpoint credentials.
  }
}
if (!client) throw new Error("NO_HEALTHY_MAINNET_RPC");

const deployer = getAddress(manifest.deployerAddress);
const factory = getAddress(manifest.protectedLaunch.launchFactory);
const expectedIdentityRegistry = getAddress(
  manifest.protectedLaunch.identityRegistry,
);
const startingNonce = await client.getTransactionCount({
  address: deployer,
  blockTag: "pending",
});
const implementation = getContractAddress({
  from: deployer,
  nonce: BigInt(startingNonce),
});
const rawIdentitySlot = await client.getStorageAt({
  address: factory,
  slot: "0x8",
});
if (
  !rawIdentitySlot ||
  getAddress(`0x${rawIdentitySlot.slice(-40)}`) !== expectedIdentityRegistry
) {
  throw new Error("IDENTITY_REGISTRY_SLOT_8_MISMATCH");
}
const upgradeData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "upgradeToAndCall",
  args: [implementation, "0x"],
});
const deploymentGas = await client.estimateGas({
  account: deployer,
  data: artifact.bytecode.object,
});
const gasPrice = await client.getGasPrice();
const unsigned = {
  schemaVersion: 1,
  feature: "protected-factory-storage-layout-recovery",
  environment: "mainnet",
  chainId: manifest.chainId,
  deployer,
  governance: getAddress(manifest.governanceAddress),
  upgrader: getAddress(manifest.upgraderAddress),
  startingNonce,
  nextDeployerNonce: startingNonce + 1,
  deployment: {
    name: "protectedLaunchFactoryImplementation",
    nonce: startingNonce,
    predictedContractAddress: implementation,
    data: artifact.bytecode.object,
    creationBytecodeSha256: createHash("sha256")
      .update(artifact.bytecode.object)
      .digest("hex"),
  },
  upgrade: {
    target: factory,
    implementation,
    data: upgradeData,
    timelockDelaySeconds: 300,
  },
  recoveryAssertions: {
    identityRegistryStorageSlot: "8",
    identityRegistry: expectedIdentityRegistry,
    quoteExecutionGuardMappingSlot: "12",
    launchIndexSlots: ["9", "10", "11"],
  },
  liveEstimate: {
    deploymentGas: deploymentGas.toString(),
    gasPriceWei: gasPrice.toString(),
    deploymentFeeWei: (deploymentGas * gasPrice).toString(),
  },
  broadcastAllowed: false,
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/protected-launch");
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(
  outputDirectory,
  "storage-layout-recovery-plan.json",
);
await writeFile(
  outputPath,
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    outputPath,
    planSha256,
    implementation,
    startingNonce,
    deploymentGas: deploymentGas.toString(),
    deploymentFeeWei: (deploymentGas * gasPrice).toString(),
    transactionsAfterApproval: 3,
    broadcast: false,
  }),
);
