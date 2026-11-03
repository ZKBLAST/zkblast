import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, type Abi, type Address, type Hex } from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, file), "utf8")) as T;
const load = async (name: string): Promise<Artifact> => readJson(`packages/contracts/out-hyperevm/${name}.sol/${name}.json`);
const dbc = await readJson<{ chainId: number; deployer: Address; governance: Address; upgrader: Address; nextNonce: number; addresses: { configRegistry: Address; launchFactory: Address }; gates: { broadcastAllowed: boolean } }>("deployments/hyperevm-mainnet/dbc-deployment-plan.json");
if (dbc.chainId !== 999 || dbc.gates.broadcastAllowed || dbc.nextNonce !== 34) throw new Error("HYPEREVM_DBC_PLAN_CONTEXT_INVALID");
const names = ["LaunchpadRegistry", "LaunchpadConfigManager", "LaunchpadFactory", "LaunchpadFeeController", "RevenueSplitter", "LaunchpadFeeCollector", "LaunchpadTokenFactory", "LaunchpadLens", "LaunchFactory", "ERC1967Proxy"] as const;
const builds = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await load(name)] as const))) as Record<string, Artifact>;
const build = (name: string): Artifact => { const value = builds[name]; if (!value?.bytecode.object || value.bytecode.object === "0x") throw new Error(`HYPEREVM_ARTIFACT_MISSING:${name}`); return value; };
const order = ["registryImplementation", "registry", "configManagerImplementation", "configManager", "factoryImplementation", "factory", "feeControllerImplementation", "feeController", "revenueSplitterImplementation", "revenueSplitter", "feeCollectorImplementation", "feeCollector", "tokenFactoryImplementation", "tokenFactory", "lens"] as const;
const addresses = Object.fromEntries(order.map((name, index) => [name, getContractAddress({ from: getAddress(dbc.deployer), nonce: BigInt(dbc.nextNonce + index) })])) as Record<(typeof order)[number], Address>;
const init = (name: string, args: readonly unknown[]): Hex => encodeFunctionData({ abi: build(name).abi, functionName: "initialize", args });
const initializer = {
  registry: init("LaunchpadRegistry", [dbc.governance, dbc.upgrader, addresses.factory]),
  configManager: init("LaunchpadConfigManager", [dbc.governance, dbc.upgrader, dbc.governance]),
  factory: init("LaunchpadFactory", [dbc.governance, dbc.upgrader, addresses.registry, addresses.configManager]),
  feeController: init("LaunchpadFeeController", [dbc.governance, dbc.upgrader, addresses.registry, dbc.governance]),
  revenueSplitter: init("RevenueSplitter", [dbc.governance, dbc.upgrader]),
  feeCollector: init("LaunchpadFeeCollector", [dbc.governance, dbc.upgrader, addresses.revenueSplitter]),
  tokenFactory: init("LaunchpadTokenFactory", [dbc.governance, dbc.upgrader, addresses.registry, addresses.configManager, dbc.addresses.launchFactory, addresses.feeController, addresses.revenueSplitter, addresses.feeCollector]),
};
const proxy = (implementation: Address, data: Hex): Hex => encodeDeployData({ abi: build("ERC1967Proxy").abi, bytecode: build("ERC1967Proxy").bytecode.object, args: [implementation, data] });
const deploymentData: Record<(typeof order)[number], Hex> = {
  registryImplementation: build("LaunchpadRegistry").bytecode.object, registry: proxy(addresses.registryImplementation, initializer.registry),
  configManagerImplementation: build("LaunchpadConfigManager").bytecode.object, configManager: proxy(addresses.configManagerImplementation, initializer.configManager),
  factoryImplementation: build("LaunchpadFactory").bytecode.object, factory: proxy(addresses.factoryImplementation, initializer.factory),
  feeControllerImplementation: build("LaunchpadFeeController").bytecode.object, feeController: proxy(addresses.feeControllerImplementation, initializer.feeController),
  revenueSplitterImplementation: build("RevenueSplitter").bytecode.object, revenueSplitter: proxy(addresses.revenueSplitterImplementation, initializer.revenueSplitter),
  feeCollectorImplementation: build("LaunchpadFeeCollector").bytecode.object, feeCollector: proxy(addresses.feeCollectorImplementation, initializer.feeCollector),
  tokenFactoryImplementation: build("LaunchpadTokenFactory").bytecode.object, tokenFactory: proxy(addresses.tokenFactoryImplementation, initializer.tokenFactory),
  lens: encodeDeployData({ abi: build("LaunchpadLens").abi, bytecode: build("LaunchpadLens").bytecode.object, args: [addresses.registry, addresses.configManager] }),
};
const role = (name: string) => keccak256(new TextEncoder().encode(name));
const factoryRole = role("ZKBLAST_FACTORY_ROLE"), dbcFactoryRole = role("ZKBLAST_DBC_LAUNCHPAD_FACTORY_ROLE"), accrualRole = role("ZKBLAST_LAUNCHPAD_FEE_ACCRUAL_ROLE");
const call = (description: string, target: Address, abiName: string, functionName: string, args: readonly unknown[]) => ({ description, target, data: encodeFunctionData({ abi: build(abiName).abi, functionName, args }) });
const configurations = [
  call("Authorize LaunchpadFactory on LaunchpadConfigManager", addresses.configManager, "LaunchpadConfigManager", "setRole", [factoryRole, addresses.factory, true]),
  call("Authorize LaunchpadTokenFactory on DBC LaunchFactory", dbc.addresses.launchFactory, "LaunchFactory", "setRole", [dbcFactoryRole, addresses.tokenFactory, true]),
  call("Authorize LaunchpadTokenFactory on LaunchpadFeeController", addresses.feeController, "LaunchpadFeeController", "setRole", [factoryRole, addresses.tokenFactory, true]),
  call("Authorize LaunchpadTokenFactory on RevenueSplitter", addresses.revenueSplitter, "RevenueSplitter", "setRole", [factoryRole, addresses.tokenFactory, true]),
  call("Authorize LaunchpadTokenFactory on LaunchpadFeeCollector", addresses.feeCollector, "LaunchpadFeeCollector", "setRole", [factoryRole, addresses.tokenFactory, true]),
  call("Authorize LaunchpadFeeCollector to accrue revenue", addresses.revenueSplitter, "RevenueSplitter", "setRole", [accrualRole, addresses.feeCollector, true]),
];
const deploymentStart = dbc.nextNonce, configurationStart = deploymentStart + order.length;
const report = {
  schemaVersion: 1, chainId: 999, kind: "offline-launchpad-deployment-plan", generatedAt: new Date().toISOString(),
  deployer: dbc.deployer, governance: dbc.governance, upgrader: dbc.upgrader, startingNonce: deploymentStart,
  deploymentTransactionCount: order.length, configurationTransactionCount: configurations.length, transactionCount: order.length + configurations.length,
  nextNonce: configurationStart + configurations.length, dependencies: { dbcConfigRegistry: dbc.addresses.configRegistry, dbcLaunchFactory: dbc.addresses.launchFactory }, addresses,
  deployments: order.map((name, index) => ({ name, nonce: deploymentStart + index, predictedContractAddress: addresses[name], data: deploymentData[name], dataHash: keccak256(deploymentData[name]), dataBytes: (deploymentData[name].length - 2) / 2 })),
  initializerHashes: Object.fromEntries(Object.entries(initializer).map(([name, data]) => [name, keccak256(data)])),
  configurations: configurations.map((item, index) => ({ description: item.description, nonce: configurationStart + index, target: item.target, data: item.data, dataHash: keccak256(item.data) })),
  capabilities: { permissionlessCreation: true, dbc: true, dammGraduation: true, dlmmGraduation: false, zkProofClaims: false },
  planSha256: "", gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false },
};
report.planSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
await writeFile(path.join(root, "deployments/hyperevm-mainnet/launchpad-deployment-plan.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: report.transactionCount, startingNonce: report.startingNonce, nextNonce: report.nextNonce, registry: addresses.registry, factory: addresses.factory, tokenFactory: addresses.tokenFactory, planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
