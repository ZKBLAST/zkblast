import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
type Receipt = Readonly<{ gasUsed: string }>;

const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async <T>(relativePath: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as T;
const artifact = async (name: string): Promise<Artifact> => {
  const value = await readJson<Artifact>(`packages/contracts/out/${name}.sol/${name}.json`);
  if (value.bytecode.object === "0x" || value.deployedBytecode.object === "0x") {
    throw new Error(`HYPEREVM_ARTIFACT_EMPTY:${name}`);
  }
  return value;
};

const preflight = await readJson<{
  chain: { chainId: number; referenceBlock: string; referenceBlockHash: Hex };
  roles: { deployer: Address; governance: Address; upgrader: Address };
  governancePlan: { deploymentNonce: number; minimumDelaySeconds: string; estimatedGas: string };
  deployer: { nonce: number };
}>("deployments/hyperevm-mainnet/preflight.json");
if (preflight.chain.chainId !== 999 || preflight.governancePlan.deploymentNonce !== preflight.deployer.nonce) {
  throw new Error("HYPEREVM_MAINNET_PREFLIGHT_CONTEXT_INVALID");
}

const reference = await readJson<{
  contracts: Record<string, { transactions: {
    implementationDeployment: Receipt;
    proxyDeploymentAndInitialization?: Receipt | null;
  } }>;
}>("deployments/mainnet/manifest.json");
const builds = Object.fromEntries(
  await Promise.all(
    ["ZKBlastTimelock", "PoolRegistry", "PoolFactory", "SwapRouter", "PositionManager", "PoolQuoter", "ERC1967Proxy"]
      .map(async (name) => [name, await artifact(name)] as const),
  ),
) as Record<string, Artifact>;
const requiredBuild = (name: string): Artifact => {
  const value = builds[name];
  if (!value) throw new Error(`HYPEREVM_ARTIFACT_MISSING:${name}`);
  return value;
};

const deployer = getAddress(preflight.roles.deployer);
const governance = getAddress(preflight.roles.governance);
const startingNonce = preflight.deployer.nonce;
const order = [
  "timelock",
  "poolRegistryImplementation",
  "poolRegistry",
  "poolFactoryImplementation",
  "poolFactory",
  "swapRouterImplementation",
  "swapRouter",
  "positionManagerImplementation",
  "positionManager",
  "poolQuoter",
] as const;
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(startingNonce + index) }),
  ]),
) as Record<(typeof order)[number], Address>;
if (getAddress(preflight.roles.upgrader) !== addresses.timelock) {
  throw new Error("HYPEREVM_TIMELOCK_PREDICTION_CHANGED");
}

const initialize = (name: string, args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: requiredBuild(name).abi, functionName: "initialize", args });
const registryInit = initialize("PoolRegistry", [governance, addresses.timelock, addresses.poolFactory]);
const factoryInit = initialize("PoolFactory", [governance, addresses.timelock, addresses.poolRegistry]);
const routerInit = initialize("SwapRouter", [governance, addresses.timelock, addresses.poolRegistry]);
const positionInit = initialize("PositionManager", [governance, addresses.timelock, addresses.poolRegistry]);
const proxyData = (implementation: Address, init: Hex): Hex =>
  encodeDeployData({ abi: requiredBuild("ERC1967Proxy").abi, bytecode: requiredBuild("ERC1967Proxy").bytecode.object, args: [implementation, init] });
const data: Record<(typeof order)[number], Hex> = {
  timelock: encodeDeployData({
    abi: requiredBuild("ZKBlastTimelock").abi,
    bytecode: requiredBuild("ZKBlastTimelock").bytecode.object,
    args: [BigInt(preflight.governancePlan.minimumDelaySeconds), governance],
  }),
  poolRegistryImplementation: requiredBuild("PoolRegistry").bytecode.object,
  poolRegistry: proxyData(addresses.poolRegistryImplementation, registryInit),
  poolFactoryImplementation: requiredBuild("PoolFactory").bytecode.object,
  poolFactory: proxyData(addresses.poolFactoryImplementation, factoryInit),
  swapRouterImplementation: requiredBuild("SwapRouter").bytecode.object,
  swapRouter: proxyData(addresses.swapRouterImplementation, routerInit),
  positionManagerImplementation: requiredBuild("PositionManager").bytecode.object,
  positionManager: proxyData(addresses.positionManagerImplementation, positionInit),
  poolQuoter: requiredBuild("PoolQuoter").bytecode.object,
};
const referenceGas = (contractName: string, kind: "implementation" | "proxy"): bigint => {
  const transactions = reference.contracts[contractName]?.transactions;
  if (!transactions) throw new Error(`REFERENCE_GAS_MISSING:${contractName}`);
  const receipt = kind === "implementation"
    ? transactions.implementationDeployment
    : transactions.proxyDeploymentAndInitialization;
  if (!receipt) throw new Error(`REFERENCE_GAS_MISSING:${contractName}:${kind}`);
  return BigInt(receipt.gasUsed);
};
const gasByName: Record<(typeof order)[number], bigint> = {
  timelock: BigInt(preflight.governancePlan.estimatedGas),
  poolRegistryImplementation: referenceGas("PoolRegistry", "implementation"),
  poolRegistry: referenceGas("PoolRegistry", "proxy"),
  poolFactoryImplementation: referenceGas("PoolFactory", "implementation"),
  poolFactory: referenceGas("PoolFactory", "proxy"),
  swapRouterImplementation: referenceGas("SwapRouter", "implementation"),
  swapRouter: referenceGas("SwapRouter", "proxy"),
  positionManagerImplementation: referenceGas("PositionManager", "implementation"),
  positionManager: referenceGas("PositionManager", "proxy"),
  poolQuoter: referenceGas("PoolQuoter", "implementation"),
};
const transactions = order.map((name, index) => ({
  index,
  nonce: startingNonce + index,
  name,
  predictedContractAddress: addresses[name],
  data: data[name],
  dataHash: keccak256(data[name]),
  dataBytes: (data[name].length - 2) / 2,
  estimatedGas: gasByName[name].toString(),
  evidence: name === "timelock" ? "chain-999 eth_estimateGas" : "same-artifact Robinhood receipt",
}));
const report = {
  schemaVersion: 1,
  chainId: 999,
  kind: "offline-core-deployment-plan",
  generatedAt: new Date().toISOString(),
  referenceBlock: preflight.chain.referenceBlock,
  referenceBlockHash: preflight.chain.referenceBlockHash,
  deployer,
  governance,
  upgrader: addresses.timelock,
  startingNonce,
  endingNonce: startingNonce + order.length - 1,
  nextNonce: startingNonce + order.length,
  transactionCount: transactions.length,
  estimatedGas: transactions.reduce((total, transaction) => total + BigInt(transaction.estimatedGas), 0n).toString(),
  addresses,
  initializerHashes: {
    poolRegistry: keccak256(registryInit),
    poolFactory: keccak256(factoryInit),
    swapRouter: keccak256(routerInit),
    positionManager: keccak256(positionInit),
  },
  artifactHashes: Object.fromEntries(
    Object.entries(builds).map(([name, build]) => [name, {
      creationBytecodeHash: keccak256(build.bytecode.object),
      runtimeBytecodeHash: keccak256(build.deployedBytecode.object),
    }]),
  ),
  transactions,
  planSha256: "",
  gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false },
};
const unsigned = JSON.stringify(report);
report.planSha256 = createHash("sha256").update(unsigned).digest("hex");
const serialized = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(path.join(root, "deployments/hyperevm-mainnet/core-deployment-plan.json"), serialized, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: report.transactionCount, startingNonce, nextNonce: report.nextNonce, estimatedGas: report.estimatedGas, timelock: addresses.timelock, poolFactory: addresses.poolFactory, report: "deployments/hyperevm-mainnet/core-deployment-plan.json", planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
