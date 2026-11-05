import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata?: string | Record<string, unknown>;
}>;

type Manifest = Readonly<{
  environment: "mainnet";
  chainId: 4663;
  deployerAddress: Address;
  governanceAddress: Address;
  upgraderAddress: Address;
  integration: { poolQuoter: Address };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as Manifest;
const startingNonce = Number(process.env.ASSISTANCE_FUND_STARTING_NONCE);
const protocolToken = getAddress(
  process.env.ASSISTANCE_FUND_PROTOCOL_TOKEN ??
    "0x3f9ff9f1d40369f99c281375bd19d6ecbebfecd7",
);
const treasuryRecipient = getAddress(
  process.env.ASSISTANCE_FUND_TREASURY_RECIPIENT ?? manifest.governanceAddress,
);
if (
  manifest.chainId !== 4663 ||
  manifest.environment !== "mainnet" ||
  !Number.isSafeInteger(startingNonce) ||
  startingNonce < 0
) {
  throw new Error("ASSISTANCE_FUND_PLAN_CONTEXT_INVALID");
}

const names = [
  "ProtocolFeeRegistry",
  "AssistanceFeeCollector",
  "TreasuryController",
  "BuybackRouteRegistry",
  "BurnModule",
  "AssistanceFundExecutor",
  "CanonicalBuybackRouterAdapter",
  "ERC1967Proxy",
] as const;
type ArtifactName = (typeof names)[number];
async function loadArtifact(name: ArtifactName): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(
      path.join(root, "packages/contracts/out", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error(`ASSISTANCE_FUND_ARTIFACT_MISSING:${name}`);
  }
  return value;
}
const artifacts = Object.fromEntries(
  await Promise.all(names.map(async (name) => [name, await loadArtifact(name)] as const)),
) as Record<ArtifactName, Artifact>;

const deploymentOrder = [
  "registryImplementation",
  "registry",
  "collectorImplementation",
  "collector",
  "treasuryControllerImplementation",
  "treasuryController",
  "routeRegistryImplementation",
  "routeRegistry",
  "burnModule",
  "executorImplementation",
  "executor",
  "routerAdapter",
] as const;
type DeploymentName = (typeof deploymentOrder)[number];
const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const upgrader = getAddress(manifest.upgraderAddress);
const addresses = Object.fromEntries(
  deploymentOrder.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(startingNonce + index) }),
  ]),
) as Record<DeploymentName, Address>;

const initialize = (name: ArtifactName, args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: artifacts[name].abi, functionName: "initialize", args });
const proxy = (implementation: Address, data: Hex): Hex =>
  encodeDeployData({
    abi: artifacts.ERC1967Proxy.abi,
    bytecode: artifacts.ERC1967Proxy.bytecode.object,
    args: [implementation, data],
  });
const deploymentData: Record<DeploymentName, Hex> = {
  registryImplementation: artifacts.ProtocolFeeRegistry.bytecode.object,
  registry: proxy(
    addresses.registryImplementation,
    initialize("ProtocolFeeRegistry", [governance]),
  ),
  collectorImplementation: artifacts.AssistanceFeeCollector.bytecode.object,
  collector: proxy(
    addresses.collectorImplementation,
    initialize("AssistanceFeeCollector", [governance, addresses.registry]),
  ),
  treasuryControllerImplementation: artifacts.TreasuryController.bytecode.object,
  treasuryController: proxy(
    addresses.treasuryControllerImplementation,
    initialize("TreasuryController", [governance, addresses.collector, treasuryRecipient]),
  ),
  routeRegistryImplementation: artifacts.BuybackRouteRegistry.bytecode.object,
  routeRegistry: proxy(
    addresses.routeRegistryImplementation,
    initialize("BuybackRouteRegistry", [governance]),
  ),
  burnModule: encodeDeployData({
    abi: artifacts.BurnModule.abi,
    bytecode: artifacts.BurnModule.bytecode.object,
    args: [protocolToken, governance],
  }),
  executorImplementation: artifacts.AssistanceFundExecutor.bytecode.object,
  executor: proxy(
    addresses.executorImplementation,
    initialize("AssistanceFundExecutor", [
      governance,
      addresses.collector,
      addresses.routeRegistry,
      addresses.burnModule,
    ]),
  ),
  routerAdapter: encodeDeployData({
    abi: artifacts.CanonicalBuybackRouterAdapter.abi,
    bytecode: artifacts.CanonicalBuybackRouterAdapter.bytecode.object,
    args: [addresses.routeRegistry, getAddress(manifest.integration.poolQuoter), addresses.executor],
  }),
};

const upgraderRole = keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE"));
const roleTargets = [
  addresses.registry,
  addresses.collector,
  addresses.treasuryController,
  addresses.routeRegistry,
  addresses.executor,
];
const governanceCalls = [
  {
    description: "Bind the 1% treasury controller",
    target: addresses.collector,
    abi: artifacts.AssistanceFeeCollector.abi,
    functionName: "bindTreasuryController",
    args: [addresses.treasuryController],
  },
  {
    description: "Bind the 99% buyback executor",
    target: addresses.collector,
    abi: artifacts.AssistanceFeeCollector.abi,
    functionName: "bindBuybackExecutor",
    args: [addresses.executor],
  },
  {
    description: "Bind executor to immutable burn module",
    target: addresses.burnModule,
    abi: artifacts.BurnModule.abi,
    functionName: "bindAssistanceFund",
    args: [addresses.executor],
  },
  ...roleTargets.map((target) => ({
    description: `Grant upgrader role on ${target}`,
    target,
    abi: artifacts.ProtocolFeeRegistry.abi,
    functionName: "setRole",
    args: [upgraderRole, upgrader, true],
  })),
].map((call) => ({
  description: call.description,
  target: call.target,
  data: encodeFunctionData({
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
  }),
}));

function compilerIdentity(artifact: Artifact) {
  const metadata = (typeof artifact.metadata === "string"
    ? JSON.parse(artifact.metadata)
    : artifact.metadata ?? {}) as {
    compiler?: { version?: string };
    settings?: { optimizer?: unknown; viaIR?: boolean; evmVersion?: string };
  };
  return {
    compiler: metadata.compiler?.version ?? "unknown",
    optimizer: metadata.settings?.optimizer ?? null,
    viaIR: metadata.settings?.viaIR ?? false,
    evmVersion: metadata.settings?.evmVersion ?? null,
  };
}
const deployments = deploymentOrder.map((name, index) => {
  const artifactName: ArtifactName = name === "registryImplementation"
    ? "ProtocolFeeRegistry"
    : name === "routeRegistryImplementation" ? "BuybackRouteRegistry"
    : name === "collectorImplementation" ? "AssistanceFeeCollector"
    : name === "treasuryControllerImplementation" ? "TreasuryController"
    : name === "executorImplementation" ? "AssistanceFundExecutor"
    : name === "burnModule" ? "BurnModule"
    : name === "routerAdapter" ? "CanonicalBuybackRouterAdapter"
    : "ERC1967Proxy";
  return {
    name,
    nonce: startingNonce + index,
    predictedContractAddress: addresses[name],
    data: deploymentData[name],
    creationBytecodeSha256: createHash("sha256").update(deploymentData[name]).digest("hex"),
    runtimeBytecodeHash: keccak256(artifacts[artifactName].deployedBytecode.object),
    compiler: compilerIdentity(artifacts[artifactName]),
  };
});
const planWithoutHash = {
  schemaVersion: 1,
  feature: "zkblast-assistance-fund",
  environment: "mainnet",
  chainId: 4663,
  deployer,
  governance,
  upgrader,
  treasuryRecipient,
  protocolToken,
  startingNonce,
  nextDeployerNonce: startingNonce + deployments.length,
  deployments,
  governanceCalls,
  addresses,
  activation: {
    registeredSources: 0,
    enabledRoutes: 0,
    pilotBudgetRaw: "0",
    failClosed: true,
  },
  gates: { broadcastAllowed: false, productionMigrationAllowed: false },
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(planWithoutHash))
  .digest("hex");
const plan = { ...planWithoutHash, planSha256 };
const outputDirectory = path.join(root, "deployments/mainnet/assistance-fund");
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "deployment-plan.json");
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ outputPath, planSha256, deployments: deployments.length, governanceCalls: governanceCalls.length, failClosed: true }, null, 2));
