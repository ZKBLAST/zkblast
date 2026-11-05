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
  protectedLaunch: Readonly<{
    launchFactory: Address;
    launchRouter: Address;
    graduationManager: Address;
    dammGraduationAdapter: Address;
    dlmmGraduationAdapter: Address;
  }>;
}>;
type Canary = Readonly<{
  chainId: 4663;
  asset: Readonly<{
    issuerAssetId: Hex;
    address: Address;
    decimals: number;
    currentMultiplier: string;
  }>;
  oracle: Readonly<{
    address: Address;
    catalogMaximumAgeSeconds: number;
    updatedAt: string;
  }>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as Manifest;
const canary = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/stock-quotes/canary-candidate.json"),
    "utf8",
  ),
) as Canary;
const startingNonce = Number(process.env.STOCK_QUOTE_STARTING_NONCE ?? "666");
if (
  manifest.environment !== "mainnet" || manifest.chainId !== 4663 || canary.chainId !== 4663 ||
  !Number.isSafeInteger(startingNonce) || startingNonce < 0
) throw new Error("STOCK_QUOTE_PLAN_CONTEXT_INVALID");

const artifactNames = [
  "GraduationAdapterRegistry",
  "StockQuoteAssetRegistry",
  "StockQuoteOracleGuard",
  "StockQuoteDestinationRegistry",
  "ProtectedLaunchFactory",
  "ProtectedGraduationManager",
  "ERC1967Proxy",
] as const;
type ArtifactName = (typeof artifactNames)[number];
async function artifact(name: ArtifactName): Promise<Artifact> {
  const result = JSON.parse(
    await readFile(
      path.join(root, "packages/contracts/out-hyperevm", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (!result.bytecode.object || result.bytecode.object === "0x") {
    throw new Error(`STOCK_QUOTE_ARTIFACT_MISSING:${name}`);
  }
  return result;
}
const artifacts = Object.fromEntries(
  await Promise.all(artifactNames.map(async (name) => [name, await artifact(name)] as const)),
) as Record<ArtifactName, Artifact>;

const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const upgrader = getAddress(manifest.upgraderAddress);
const order = [
  "adapterRegistryImplementation",
  "adapterRegistry",
  "assetRegistryImplementation",
  "assetRegistry",
  "oracleGuardImplementation",
  "oracleGuard",
  "destinationRegistryImplementation",
  "destinationRegistry",
  "protectedLaunchFactoryImplementation",
  "protectedGraduationManagerImplementation",
] as const;
type DeploymentName = (typeof order)[number];
const addresses = Object.fromEntries(
  order.map((name, index) => [
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
  adapterRegistryImplementation: artifacts.GraduationAdapterRegistry.bytecode.object,
  adapterRegistry: proxy(
    addresses.adapterRegistryImplementation,
    initialize("GraduationAdapterRegistry", [governance, upgrader]),
  ),
  assetRegistryImplementation: artifacts.StockQuoteAssetRegistry.bytecode.object,
  assetRegistry: proxy(
    addresses.assetRegistryImplementation,
    initialize("StockQuoteAssetRegistry", [governance, upgrader]),
  ),
  oracleGuardImplementation: artifacts.StockQuoteOracleGuard.bytecode.object,
  oracleGuard: proxy(
    addresses.oracleGuardImplementation,
    initialize("StockQuoteOracleGuard", [governance, upgrader, governance, addresses.assetRegistry]),
  ),
  destinationRegistryImplementation: artifacts.StockQuoteDestinationRegistry.bytecode.object,
  destinationRegistry: proxy(
    addresses.destinationRegistryImplementation,
    initialize("StockQuoteDestinationRegistry", [
      governance,
      upgrader,
      addresses.assetRegistry,
      addresses.adapterRegistry,
    ]),
  ),
  protectedLaunchFactoryImplementation: artifacts.ProtectedLaunchFactory.bytecode.object,
  protectedGraduationManagerImplementation: artifacts.ProtectedGraduationManager.bytecode.object,
};

const reviewHash = (label: string): Hex =>
  keccak256(new TextEncoder().encode(`ZKBLAST_STOCK_QUOTE_${label}_V1`));
const calls = [
  {
    actor: "governance",
    description: "Register canonical Protected DAMM adapter",
    target: addresses.adapterRegistry,
    abi: artifacts.GraduationAdapterRegistry.abi,
    functionName: "register",
    args: [
      getAddress(manifest.protectedLaunch.dammGraduationAdapter),
      getAddress(manifest.protectedLaunch.launchRouter),
      reviewHash("DAMM_ADAPTER_REVIEW"),
    ],
  },
  {
    actor: "governance",
    description: "Register canonical Protected DLMM adapter",
    target: addresses.adapterRegistry,
    abi: artifacts.GraduationAdapterRegistry.abi,
    functionName: "register",
    args: [
      getAddress(manifest.protectedLaunch.dlmmGraduationAdapter),
      getAddress(manifest.protectedLaunch.launchRouter),
      reviewHash("DLMM_ADAPTER_REVIEW"),
    ],
  },
  {
    actor: "governance",
    description: "List MSFT stock quote in disabled fail-closed state",
    target: addresses.assetRegistry,
    abi: artifacts.StockQuoteAssetRegistry.abi,
    functionName: "list",
    args: [
      getAddress(canary.asset.address),
      [
        false,
        false,
        false,
        getAddress(canary.oracle.address),
        canary.asset.decimals,
        canary.oracle.catalogMaximumAgeSeconds,
        500,
        100n * 10n ** 18n,
        500n * 10n ** 18n,
        canary.asset.issuerAssetId,
      ],
    ],
  },
  {
    actor: "governance",
    description: "Configure closed MSFT session without enabling trading",
    target: addresses.oracleGuard,
    abi: artifacts.StockQuoteOracleGuard.abi,
    functionName: "setSessionPolicy",
    args: [
      getAddress(canary.asset.address),
      2,
      BigInt(canary.asset.currentMultiplier.replace(".", "")),
      false,
      BigInt(Math.floor(new Date(canary.oracle.updatedAt).getTime() / 1_000)),
    ],
  },
  {
    actor: "upgrader",
    description: "Upgrade Protected Launch Factory implementation",
    target: getAddress(manifest.protectedLaunch.launchFactory),
    abi: artifacts.ProtectedLaunchFactory.abi,
    functionName: "upgradeToAndCall",
    args: [addresses.protectedLaunchFactoryImplementation, "0x"],
  },
  {
    actor: "upgrader",
    description: "Upgrade Protected Graduation Manager implementation",
    target: getAddress(manifest.protectedLaunch.graduationManager),
    abi: artifacts.ProtectedGraduationManager.abi,
    functionName: "upgradeToAndCall",
    args: [addresses.protectedGraduationManagerImplementation, "0x"],
  },
  {
    actor: "governance",
    description: "Bind stock destination registry to Protected Graduation Manager",
    target: getAddress(manifest.protectedLaunch.graduationManager),
    abi: artifacts.ProtectedGraduationManager.abi,
    functionName: "setStockQuoteDestinationRegistry",
    args: [addresses.destinationRegistry],
  },
  {
    actor: "governance",
    description: "Bind MSFT execution guard to Protected Launch Factory",
    target: getAddress(manifest.protectedLaunch.launchFactory),
    abi: [
      {
        type: "function",
        name: "bindQuoteExecutionGuard",
        stateMutability: "nonpayable",
        inputs: [
          { name: "quoteToken", type: "address" },
          { name: "guard", type: "address" },
        ],
        outputs: [],
      },
    ] as const,
    functionName: "bindQuoteExecutionGuard",
    args: [getAddress(canary.asset.address), addresses.oracleGuard],
  },
].map((call) => ({
  actor: call.actor,
  description: call.description,
  target: call.target,
  data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
}));

const deployments = order.map((name, index) => ({
  name,
  nonce: startingNonce + index,
  predictedContractAddress: addresses[name],
  data: deploymentData[name],
  creationBytecodeSha256: createHash("sha256").update(deploymentData[name]).digest("hex"),
}));
const unsigned = {
  schemaVersion: 1,
  feature: "stock-quote-assets-damm-dlmm",
  environment: "mainnet",
  chainId: 4663,
  deployer,
  governance,
  upgrader,
  startingNonce,
  nextDeployerNonce: startingNonce + order.length,
  deployments,
  calls,
  addresses,
  canaryAsset: getAddress(canary.asset.address),
  releaseState: {
    quoteTradingEnabled: false,
    graduationEnabled: false,
    dammEnabled: false,
    dlmmEnabled: false,
  },
  gates: { broadcastAllowed: false, activationAllowed: false },
};
const planSha256 = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "deployment-plan.json");
await writeFile(outputPath, `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, planSha256, deployments: deployments.length, calls: calls.length }, null, 2));
