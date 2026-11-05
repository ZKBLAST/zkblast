import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeDeployData,
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
  protectedLaunch: Readonly<{ launchFactory: Address }>;
  stockQuoteAssets: Readonly<{
    assetRegistry: Address;
    oracleGuard: Address;
    canaryAsset: Address;
  }>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as Manifest;
if (manifest.environment !== "mainnet" || manifest.chainId !== 4663) {
  throw new Error("STOCK_QUOTE_POLICY_UPGRADE_CONTEXT_INVALID");
}
const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error("RPC_URL_REQUIRED");
const fallbackUrls = (process.env.RPC_FALLBACK_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const publicFallbackUrl = "https://robinhood.drpc.org";
const rpcUrls = [
  ...new Set([
    rpcUrl,
    ...fallbackUrls,
    publicFallbackUrl,
  ]),
];
async function selectHealthyClient() {
  const failures: string[] = [];
  for (const [index, url] of rpcUrls.entries()) {
    const candidate = createPublicClient({
      transport: http(url, { timeout: 12_000, retryCount: 0 }),
    });
    try {
      const chainId = await candidate.getChainId();
      if (chainId !== manifest.chainId) {
        failures.push(`rpc-${index + 1}:chain-${chainId}`);
        continue;
      }
      console.log(JSON.stringify({ selectedRpc: `rpc-${index + 1}`, fallback: index > 0 }));
      return candidate;
    } catch {
      failures.push(`rpc-${index + 1}:unavailable`);
    }
  }
  throw new Error(`NO_HEALTHY_MAINNET_RPC:${failures.join(",")}`);
}
const client = await selectHealthyClient();
const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const upgrader = getAddress(manifest.upgraderAddress);
const startingNonce = await client.getTransactionCount({ address: deployer, blockTag: "pending" });

const artifactNames = [
  "StockQuoteAssetRegistry",
  "StockQuoteOracleGuard",
  "ProtectedLaunchFactory",
  "ProtectedVirtualPoolDeployer",
] as const;
type ArtifactName = (typeof artifactNames)[number];
async function artifact(name: ArtifactName): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(
      path.join(root, "packages/contracts/out-hyperevm", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error(`ARTIFACT_MISSING:${name}`);
  }
  return value;
}
const artifacts = Object.fromEntries(
  await Promise.all(artifactNames.map(async (name) => [name, await artifact(name)] as const)),
) as Record<ArtifactName, Artifact>;
const order = [
  "assetRegistryImplementation",
  "oracleGuardImplementation",
  "protectedLaunchFactoryImplementation",
  "protectedVirtualPoolDeployer",
] as const;
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(startingNonce + index) }),
  ]),
) as Record<(typeof order)[number], Address>;
const deploymentData: Record<(typeof order)[number], Hex> = {
  assetRegistryImplementation: artifacts.StockQuoteAssetRegistry.bytecode.object,
  oracleGuardImplementation: artifacts.StockQuoteOracleGuard.bytecode.object,
  protectedLaunchFactoryImplementation: artifacts.ProtectedLaunchFactory.bytecode.object,
  protectedVirtualPoolDeployer: encodeDeployData({
    abi: artifacts.ProtectedVirtualPoolDeployer.abi,
    bytecode: artifacts.ProtectedVirtualPoolDeployer.bytecode.object,
    args: [governance],
  }),
};
const deployments = order.map((name, index) => ({
  name,
  nonce: startingNonce + index,
  predictedContractAddress: addresses[name],
  data: deploymentData[name],
  creationBytecodeSha256: createHash("sha256").update(deploymentData[name]).digest("hex"),
}));
const calls = [
  {
    actor: "upgrader",
    description: "Upgrade Stock Quote Asset Registry with explicit version reads",
    target: getAddress(manifest.stockQuoteAssets.assetRegistry),
    abi: artifacts.StockQuoteAssetRegistry.abi,
    functionName: "upgradeToAndCall",
    args: [addresses.assetRegistryImplementation, "0x"],
  },
  {
    actor: "upgrader",
    description: "Upgrade Stock Quote Oracle Guard with versioned policy identity",
    target: getAddress(manifest.stockQuoteAssets.oracleGuard),
    abi: artifacts.StockQuoteOracleGuard.abi,
    functionName: "upgradeToAndCall",
    args: [addresses.oracleGuardImplementation, "0x"],
  },
  {
    actor: "upgrader",
    description: "Upgrade Protected Launch Factory with stock policy binding receipts",
    target: getAddress(manifest.protectedLaunch.launchFactory),
    abi: artifacts.ProtectedLaunchFactory.abi,
    functionName: "upgradeToAndCall",
    args: [addresses.protectedLaunchFactoryImplementation, "0x"],
  },
  {
    actor: "governance",
    description: "Bind replacement Protected pool deployer to canonical factory",
    target: addresses.protectedVirtualPoolDeployer,
    abi: artifacts.ProtectedVirtualPoolDeployer.abi,
    functionName: "bindFactory",
    args: [getAddress(manifest.protectedLaunch.launchFactory)],
  },
  {
    actor: "governance",
    description: "Install receipt-enabled Protected pool deployer",
    target: getAddress(manifest.protectedLaunch.launchFactory),
    abi: artifacts.ProtectedLaunchFactory.abi,
    functionName: "setPoolDeployer",
    args: [addresses.protectedVirtualPoolDeployer],
  },
].map((call) => ({
  actor: call.actor,
  description: call.description,
  target: call.target,
  data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }),
}));
const unsigned = {
  schemaVersion: 1,
  feature: "stock-quote-policy-receipts",
  environment: "mainnet",
  chainId: manifest.chainId,
  deployer,
  governance,
  upgrader,
  startingNonce,
  nextDeployerNonce: startingNonce + deployments.length,
  deployments,
  calls,
  addresses,
  canaryAsset: getAddress(manifest.stockQuoteAssets.canaryAsset),
  releaseState: { quoteTradingEnabled: false, graduationEnabled: false },
  gates: { broadcastAllowed: false, activationAllowed: false },
};
const planSha256 = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "policy-receipts-upgrade-plan.json");
await writeFile(outputPath, `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`);
console.log(
  JSON.stringify(
    { outputPath, planSha256, startingNonce, deployments: deployments.length, calls: calls.length },
    null,
    2,
  ),
);
