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
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, ReadonlyArray<{ start: number; length: number }>>;
  };
}>;

type Manifest = Readonly<{
  environment: "mainnet" | "testnet";
  chainId: number;
  deployerAddress: Address;
  governanceAddress: Address;
  upgraderAddress: Address;
  integration: { poolFactory: Address };
  dbc?: { configRegistry: Address };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
const chainId = Number(process.env.CHAIN_ID);
const startingNonce = Number(process.env.PROTECTED_LAUNCH_STARTING_NONCE);
if (
  (environment !== "mainnet" && environment !== "testnet") ||
  !Number.isSafeInteger(chainId) ||
  chainId <= 0 ||
  !Number.isSafeInteger(startingNonce) ||
  startingNonce < 0
) {
  throw new Error("PROTECTED_LAUNCH_PLAN_CONTEXT_INVALID");
}

const deploymentDirectory =
  chainId === 999
    ? "hyperevm-mainnet"
    : environment;
const manifestPath = path.join(
  root,
  `deployments/${deploymentDirectory}/manifest.json`,
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
if (
  manifest.chainId !== chainId ||
  manifest.environment !== environment ||
  !manifest.dbc?.configRegistry
) {
  throw new Error("PROTECTED_LAUNCH_MANIFEST_CONTEXT_INVALID");
}

const artifactRoot = path.join(
  root,
  chainId === 999 ? "packages/contracts/out-hyperevm" : "packages/contracts/out",
);
async function artifact(name: string): Promise<Artifact> {
  const result = JSON.parse(
    await readFile(path.join(artifactRoot, `${name}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
  if (!result.bytecode.object || result.bytecode.object === "0x") {
    throw new Error(`PROTECTED_LAUNCH_ARTIFACT_MISSING:${name}`);
  }
  return result;
}

const contractNames = [
  "LaunchProtectionPolicyRegistry",
  "ProtectedLPAllocationEscrow",
  "ProtectedLaunchIdentityRegistry",
  "ProtectedLaunchFactory",
  "ProtectedLaunchRouter",
  "ProtectedGraduationManager",
  "ProtectedLaunchTokenDeployer",
  "ProtectedVirtualPoolDeployer",
  "DammGraduationAdapter",
  "DlmmGraduationAdapter",
  "LaunchConfigRegistry",
  "ERC1967Proxy",
] as const;
const artifacts = Object.fromEntries(
  await Promise.all(
    contractNames.map(async (name) => [name, await artifact(name)] as const),
  ),
) as Record<(typeof contractNames)[number], Artifact>;

const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const upgrader = getAddress(manifest.upgraderAddress);
const order = [
  "policyRegistryImplementation",
  "policyRegistry",
  "lpEscrowImplementation",
  "lpEscrow",
  "identityRegistryImplementation",
  "identityRegistry",
  "tokenDeployer",
  "virtualPoolDeployer",
  "factoryImplementation",
  "factory",
  "routerImplementation",
  "router",
  "graduationManagerImplementation",
  "graduationManager",
  "dammGraduationAdapter",
  "dlmmGraduationAdapter",
] as const;
type DeploymentName = (typeof order)[number];
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(startingNonce + index) }),
  ]),
) as Record<DeploymentName, Address>;

const init = (name: (typeof contractNames)[number], args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: artifacts[name].abi, functionName: "initialize", args });
const initializer = {
  policyRegistry: init("LaunchProtectionPolicyRegistry", [
    governance,
    upgrader,
    governance,
  ]),
  lpEscrow: init("ProtectedLPAllocationEscrow", [governance, upgrader]),
  identityRegistry: init("ProtectedLaunchIdentityRegistry", [
    governance,
    upgrader,
    addresses.factory,
  ]),
  factory: init("ProtectedLaunchFactory", [
    governance,
    upgrader,
    getAddress(manifest.dbc.configRegistry),
    addresses.policyRegistry,
    addresses.tokenDeployer,
    addresses.virtualPoolDeployer,
    addresses.identityRegistry,
  ]),
  router: init("ProtectedLaunchRouter", [
    governance,
    upgrader,
    addresses.factory,
  ]),
  graduationManager: init("ProtectedGraduationManager", [
    governance,
    upgrader,
    addresses.factory,
    addresses.lpEscrow,
  ]),
};
const proxy = (implementation: Address, data: Hex): Hex =>
  encodeDeployData({
    abi: artifacts.ERC1967Proxy.abi,
    bytecode: artifacts.ERC1967Proxy.bytecode.object,
    args: [implementation, data],
  });
const deploymentData: Record<DeploymentName, Hex> = {
  policyRegistryImplementation: artifacts.LaunchProtectionPolicyRegistry.bytecode.object,
  policyRegistry: proxy(addresses.policyRegistryImplementation, initializer.policyRegistry),
  lpEscrowImplementation: artifacts.ProtectedLPAllocationEscrow.bytecode.object,
  lpEscrow: proxy(addresses.lpEscrowImplementation, initializer.lpEscrow),
  identityRegistryImplementation: artifacts.ProtectedLaunchIdentityRegistry.bytecode.object,
  identityRegistry: proxy(
    addresses.identityRegistryImplementation,
    initializer.identityRegistry,
  ),
  factoryImplementation: artifacts.ProtectedLaunchFactory.bytecode.object,
  factory: proxy(addresses.factoryImplementation, initializer.factory),
  routerImplementation: artifacts.ProtectedLaunchRouter.bytecode.object,
  router: proxy(addresses.routerImplementation, initializer.router),
  graduationManagerImplementation: artifacts.ProtectedGraduationManager.bytecode.object,
  graduationManager: proxy(
    addresses.graduationManagerImplementation,
    initializer.graduationManager,
  ),
  tokenDeployer: encodeDeployData({
    abi: artifacts.ProtectedLaunchTokenDeployer.abi,
    bytecode: artifacts.ProtectedLaunchTokenDeployer.bytecode.object,
    args: [governance],
  }),
  virtualPoolDeployer: encodeDeployData({
    abi: artifacts.ProtectedVirtualPoolDeployer.abi,
    bytecode: artifacts.ProtectedVirtualPoolDeployer.bytecode.object,
    args: [governance],
  }),
  dammGraduationAdapter: encodeDeployData({
    abi: artifacts.DammGraduationAdapter.abi,
    bytecode: artifacts.DammGraduationAdapter.bytecode.object,
    args: [addresses.graduationManager, getAddress(manifest.integration.poolFactory)],
  }),
  dlmmGraduationAdapter: encodeDeployData({
    abi: artifacts.DlmmGraduationAdapter.abi,
    bytecode: artifacts.DlmmGraduationAdapter.bytecode.object,
    args: [
      addresses.graduationManager,
      getAddress(manifest.integration.poolFactory),
      governance,
      25,
    ],
  }),
};

function runtimeIdentity(artifact: Artifact) {
  const bytes = artifact.deployedBytecode.object.slice(2).split("");
  const references = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
  for (const reference of references) {
    bytes.fill("0", reference.start * 2, (reference.start + reference.length) * 2);
  }
  return {
    normalizedHash: keccak256(`0x${bytes.join("")}` as Hex),
    immutableReferences: references,
  };
}

const role = (name: string): Hex =>
  keccak256(new TextEncoder().encode(name));
const governanceCalls = [
  {
    description: "Bind Protected token deployer",
    target: addresses.tokenDeployer,
    abi: "ProtectedLaunchTokenDeployer" as const,
    functionName: "bindFactory",
    args: [addresses.factory],
  },
  {
    description: "Bind Protected pool deployer",
    target: addresses.virtualPoolDeployer,
    abi: "ProtectedVirtualPoolDeployer" as const,
    functionName: "bindFactory",
    args: [addresses.factory],
  },
  {
    description: "Authorize Protected factory on DBC template registry",
    target: getAddress(manifest.dbc.configRegistry),
    abi: "LaunchConfigRegistry" as const,
    functionName: "setRole",
    args: [role("ZKBLAST_FACTORY_ROLE"), addresses.factory, true],
  },
  {
    description: "Authorize Protected factory on policy registry",
    target: addresses.policyRegistry,
    abi: "LaunchProtectionPolicyRegistry" as const,
    functionName: "setRole",
    args: [role("ZKBLAST_PROTECTION_POLICY_CONSUMER_ROLE"), addresses.factory, true],
  },
  {
    description: "Authorize Protected graduation manager on LP escrow",
    target: addresses.lpEscrow,
    abi: "ProtectedLPAllocationEscrow" as const,
    functionName: "setRole",
    args: [
      role("ZKBLAST_PROTECTED_GRADUATION_MANAGER_ROLE"),
      addresses.graduationManager,
      true,
    ],
  },
  {
    description: "Bind Protected graduation manager to factory",
    target: addresses.factory,
    abi: "ProtectedLaunchFactory" as const,
    functionName: "setGraduationManager",
    args: [addresses.graduationManager],
  },
  {
    description: "Allow DAMM graduation adapter",
    target: addresses.graduationManager,
    abi: "ProtectedGraduationManager" as const,
    functionName: "setAdapter",
    args: [addresses.dammGraduationAdapter, true],
  },
  {
    description: "Allow DLMM graduation adapter",
    target: addresses.graduationManager,
    abi: "ProtectedGraduationManager" as const,
    functionName: "setAdapter",
    args: [addresses.dlmmGraduationAdapter, true],
  },
].map((call) => ({
  description: call.description,
  target: call.target,
  data: encodeFunctionData({
    abi: artifacts[call.abi].abi,
    functionName: call.functionName,
    args: call.args,
  }),
}));

const deployments = order.map((name, index) => ({
  name,
  nonce: startingNonce + index,
  predictedContractAddress: addresses[name],
  data: deploymentData[name],
  dataHash: keccak256(deploymentData[name]),
  runtimeIdentity:
    name.endsWith("Implementation") ||
    name === "tokenDeployer" ||
    name === "virtualPoolDeployer" ||
    name.endsWith("Adapter")
      ? runtimeIdentity(
          artifacts[
            name === "policyRegistryImplementation"
              ? "LaunchProtectionPolicyRegistry"
              : name === "lpEscrowImplementation"
                ? "ProtectedLPAllocationEscrow"
                : name === "identityRegistryImplementation"
                  ? "ProtectedLaunchIdentityRegistry"
                  : name === "factoryImplementation"
                    ? "ProtectedLaunchFactory"
                    : name === "routerImplementation"
                      ? "ProtectedLaunchRouter"
                      : name === "graduationManagerImplementation"
                        ? "ProtectedGraduationManager"
                        : name === "tokenDeployer"
                          ? "ProtectedLaunchTokenDeployer"
                          : name === "virtualPoolDeployer"
                            ? "ProtectedVirtualPoolDeployer"
                            : name === "dammGraduationAdapter"
                              ? "DammGraduationAdapter"
                              : "DlmmGraduationAdapter"
          ],
        )
      : null,
}));
const unsignedPlan = {
  schemaVersion: 1,
  kind: "protected-launch-deployment-plan",
  generatedAt: new Date().toISOString(),
  environment,
  chainId,
  deployer,
  governance,
  upgrader,
  startingNonce,
  deploymentTransactionCount: deployments.length,
  governanceTransactionCount: governanceCalls.length,
  nextDeployerNonce: startingNonce + deployments.length,
  dependencies: {
    templateRegistry: getAddress(manifest.dbc.configRegistry),
    poolFactory: getAddress(manifest.integration.poolFactory),
  },
  addresses,
  deployments,
  initializerHashes: Object.fromEntries(
    Object.entries(initializer).map(([name, data]) => [name, keccak256(data)]),
  ),
  governanceCalls: governanceCalls.map((call) => ({
    ...call,
    dataHash: keccak256(call.data),
  })),
  manifestExtension: {
    abiVersion: 1,
    deploymentBlock: 0,
    policyRegistry: addresses.policyRegistry,
    launchFactory: addresses.factory,
    launchRouter: addresses.router,
    tokenDeployer: addresses.tokenDeployer,
    virtualPoolDeployer: addresses.virtualPoolDeployer,
    lpEscrow: addresses.lpEscrow,
    graduationManager: addresses.graduationManager,
    dammGraduationAdapter: addresses.dammGraduationAdapter,
    dlmmGraduationAdapter: addresses.dlmmGraduationAdapter,
    identityRegistry: addresses.identityRegistry,
  },
  gates: {
    privateKeysRead: false,
    broadcastAllowed: false,
    sequentialSimulationPassed: false,
    governanceCallsExecuted: false,
  },
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsignedPlan))
  .digest("hex");
const plan = { ...unsignedPlan, planSha256 };
const outputDirectory = path.join(
  root,
  `deployments/${deploymentDirectory}/protected-launch`,
);
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "deployment-plan.json");
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
console.log(
  JSON.stringify(
    {
      outputPath,
      chainId,
      transactionCount:
        plan.deploymentTransactionCount + plan.governanceTransactionCount,
      startingNonce,
      nextDeployerNonce: plan.nextDeployerNonce,
      protectedFactory: addresses.factory,
      planSha256,
      broadcastAllowed: false,
    },
    null,
    2,
  ),
);
