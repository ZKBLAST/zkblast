import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, toHex, type Abi, type Address, type Hex } from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, file), "utf8")) as T;
const load = async (name: string): Promise<Artifact> => {
  const value = await readJson<Artifact>(`packages/contracts/out-hyperevm/${name}.sol/${name}.json`);
  if (value.bytecode.object === "0x") throw new Error(`HYPEREVM_ARTIFACT_EMPTY:${name}`);
  return value;
};
const core = await readJson<{ chainId: number; deployer: Address; governance: Address; upgrader: Address; nextNonce: number; addresses: { poolFactory: Address }; gates: { broadcastAllowed: boolean } }>("deployments/hyperevm-mainnet/core-deployment-plan.json");
if (core.chainId !== 999 || core.gates.broadcastAllowed || core.nextNonce !== 10) throw new Error("HYPEREVM_CORE_PLAN_CONTEXT_INVALID");
const preflight = await readJson<{ reserveAsset: { address: Address; symbol: string; decimals: number } }>("deployments/hyperevm-mainnet/preflight.json");
if (preflight.reserveAsset.symbol !== "WHYPE" || preflight.reserveAsset.decimals !== 18) throw new Error("HYPEREVM_RESERVE_CONTEXT_INVALID");
const names = ["LaunchConfigRegistry", "LaunchTokenDeployer", "HyperEvmVirtualPool", "HyperEvmVirtualPoolDeployer", "LaunchFactory", "LaunchpadRouter", "LPAllocationEscrow", "HyperEvmGraduationManager", "CurveQuoter", "DammGraduationAdapter", "ERC1967Proxy"] as const;
const builds = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await load(name)] as const))) as Record<string, Artifact>;
const build = (name: string): Artifact => { const value = builds[name]; if (!value) throw new Error(`HYPEREVM_ARTIFACT_MISSING:${name}`); return value; };
const order = ["configRegistryImplementation", "configRegistry", "launchTokenDeployer", "virtualPoolImplementation", "virtualPoolDeployer", "launchFactoryImplementation", "launchFactory", "launchpadRouterImplementation", "launchpadRouter", "lpAllocationEscrowImplementation", "lpAllocationEscrow", "graduationManagerImplementation", "graduationManager", "curveQuoter", "dammGraduationAdapter"] as const;
const addresses = Object.fromEntries(order.map((name, index) => [name, getContractAddress({ from: getAddress(core.deployer), nonce: BigInt(core.nextNonce + index) })])) as Record<(typeof order)[number], Address>;
const init = (name: string, args: readonly unknown[]): Hex => encodeFunctionData({ abi: build(name).abi, functionName: "initialize", args });
const initializer = {
  configRegistry: init("LaunchConfigRegistry", [core.governance, core.upgrader, core.governance]),
  launchFactory: init("LaunchFactory", [core.governance, core.upgrader, addresses.configRegistry, addresses.launchTokenDeployer, addresses.virtualPoolDeployer]),
  launchpadRouter: init("LaunchpadRouter", [core.governance, core.upgrader, addresses.launchFactory]),
  lpAllocationEscrow: init("LPAllocationEscrow", [core.governance, core.upgrader]),
  graduationManager: init("HyperEvmGraduationManager", [core.governance, core.upgrader, addresses.launchFactory, addresses.lpAllocationEscrow]),
};
const proxy = (implementation: Address, data: Hex): Hex => encodeDeployData({ abi: build("ERC1967Proxy").abi, bytecode: build("ERC1967Proxy").bytecode.object, args: [implementation, data] });
const deploymentData: Record<(typeof order)[number], Hex> = {
  configRegistryImplementation: build("LaunchConfigRegistry").bytecode.object,
  configRegistry: proxy(addresses.configRegistryImplementation, initializer.configRegistry),
  launchTokenDeployer: encodeDeployData({ abi: build("LaunchTokenDeployer").abi, bytecode: build("LaunchTokenDeployer").bytecode.object, args: [core.governance] }),
  virtualPoolImplementation: build("HyperEvmVirtualPool").bytecode.object,
  virtualPoolDeployer: encodeDeployData({ abi: build("HyperEvmVirtualPoolDeployer").abi, bytecode: build("HyperEvmVirtualPoolDeployer").bytecode.object, args: [core.governance, addresses.virtualPoolImplementation] }),
  launchFactoryImplementation: build("LaunchFactory").bytecode.object,
  launchFactory: proxy(addresses.launchFactoryImplementation, initializer.launchFactory),
  launchpadRouterImplementation: build("LaunchpadRouter").bytecode.object,
  launchpadRouter: proxy(addresses.launchpadRouterImplementation, initializer.launchpadRouter),
  lpAllocationEscrowImplementation: build("LPAllocationEscrow").bytecode.object,
  lpAllocationEscrow: proxy(addresses.lpAllocationEscrowImplementation, initializer.lpAllocationEscrow),
  graduationManagerImplementation: build("HyperEvmGraduationManager").bytecode.object,
  graduationManager: proxy(addresses.graduationManagerImplementation, initializer.graduationManager),
  curveQuoter: build("CurveQuoter").bytecode.object,
  dammGraduationAdapter: encodeDeployData({ abi: build("DammGraduationAdapter").abi, bytecode: build("DammGraduationAdapter").bytecode.object, args: [addresses.graduationManager, core.addresses.poolFactory] }),
};
const factoryRole = keccak256(toHex("ZKBLAST_FACTORY_ROLE"));
const managerRole = keccak256(toHex("ZKBLAST_DBC_GRADUATION_MANAGER_ROLE"));
const quoteToken = getAddress(preflight.reserveAsset.address);
const template = {
  quoteToken, protocolFeeRecipient: core.governance, partnerFeeRecipient: core.governance, protocolLpRecipient: core.governance,
  quoteDecimals: 18, baseDecimals: 18, migrationMode: 0, destinationFeePips: 3_000, terminalPriceToleranceBps: 100,
  totalSupplyRaw: 1_000_000n * 10n ** 18n, baseInventoryRaw: 800_000n * 10n ** 18n,
  graduationThresholdRaw: 10n ** 16n, minimumDestinationShares: 1n,
  curve: { segmentCount: 1, segments: Array.from({ length: 16 }, (_, index) => index === 0 ? { initialPriceX18: 1_000_000_000_000n, slopeX18: 1_000_000n, saleCapacityX18: 800_000n * 10n ** 18n } : { initialPriceX18: 0n, slopeX18: 0n, saleCapacityX18: 0n }) },
  fees: { tradeFeeBps: 30, creatorShareBps: 5_000, partnerShareBps: 0, protocolShareBps: 5_000 },
  lp: { creatorShareBps: 5_000, protocolShareBps: 5_000, creatorLockSeconds: 300 },
};
const config = (name: string, to: Address, abiName: string, functionName: string, args: readonly unknown[]) => ({ name, to, data: encodeFunctionData({ abi: build(abiName).abi, functionName, args }) });
const configurations = [
  config("bindLaunchTokenDeployer", addresses.launchTokenDeployer, "LaunchTokenDeployer", "bindFactory", [addresses.launchFactory]),
  config("bindVirtualPoolDeployer", addresses.virtualPoolDeployer, "HyperEvmVirtualPoolDeployer", "bindFactory", [addresses.launchFactory]),
  config("allowWhypeQuoteToken", addresses.configRegistry, "LaunchConfigRegistry", "setQuoteToken", [quoteToken, true]),
  config("authorizeLaunchFactory", addresses.configRegistry, "LaunchConfigRegistry", "setRole", [factoryRole, addresses.launchFactory, true]),
  config("bindGraduationManager", addresses.launchFactory, "LaunchFactory", "setGraduationManager", [addresses.graduationManager]),
  config("allowDammAdapter", addresses.graduationManager, "HyperEvmGraduationManager", "setAdapter", [addresses.dammGraduationAdapter, true]),
  config("authorizeGraduationManager", addresses.lpAllocationEscrow, "LPAllocationEscrow", "setRole", [managerRole, addresses.graduationManager, true]),
  { name: "authorizeAdapterOnPoolFactory", to: core.addresses.poolFactory, data: encodeFunctionData({ abi: [{ type: "function", name: "setRole", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }, { name: "enabled", type: "bool" }], outputs: [] }], functionName: "setRole", args: [factoryRole, addresses.dammGraduationAdapter, true] }) },
  config("createWhypeCanaryTemplate", addresses.configRegistry, "LaunchConfigRegistry", "createTemplate", [keccak256(toHex("ZKBLAST_HYPEREVM_WHYPE_CANARY_V1")), template]),
];
const deploymentStart = core.nextNonce;
const configurationStart = deploymentStart + order.length;
const report = {
  schemaVersion: 1, chainId: 999, kind: "offline-dbc-deployment-plan", generatedAt: new Date().toISOString(),
  deployer: core.deployer, governance: core.governance, upgrader: core.upgrader, startingNonce: deploymentStart,
  deploymentTransactionCount: order.length, configurationTransactionCount: configurations.length,
  transactionCount: order.length + configurations.length, nextNonce: configurationStart + configurations.length,
  dependencies: { quoteToken, poolFactory: core.addresses.poolFactory }, addresses,
  deployments: order.map((name, index) => ({ name, nonce: deploymentStart + index, predictedContractAddress: addresses[name], data: deploymentData[name], dataHash: keccak256(deploymentData[name]), dataBytes: (deploymentData[name].length - 2) / 2 })),
  initializerHashes: Object.fromEntries(Object.entries(initializer).map(([name, data]) => [name, keccak256(data)])),
  configurations: configurations.map((item, index) => ({ name: item.name, nonce: configurationStart + index, to: item.to, data: item.data, dataHash: keccak256(item.data) })),
  candidateTemplate: template, candidateTemplateApproved: true,
  planSha256: "", gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false, economicsApproved: true },
};
const stringify = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
report.planSha256 = createHash("sha256").update(stringify(report)).digest("hex");
await writeFile(path.join(root, "deployments/hyperevm-mainnet/dbc-deployment-plan.json"), `${JSON.stringify(report, (_, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: report.transactionCount, startingNonce: report.startingNonce, nextNonce: report.nextNonce, quoteToken, launchFactory: addresses.launchFactory, graduationManager: addresses.graduationManager, planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
