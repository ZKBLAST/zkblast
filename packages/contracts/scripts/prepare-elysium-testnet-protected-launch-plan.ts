import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, type Abi, type Address, type Hex } from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, file), "utf8")) as T;
const load = async (name: string): Promise<Artifact> => readJson(`packages/contracts/out-elysium/${name}.sol/${name}.json`);
const dbc = await readJson<{ chainId: number; deployer: Address; governance: Address; upgrader: Address; addresses: { configRegistry: Address }; gates: { broadcastAllowed: boolean } }>("deployments/elysium-testnet/dbc-deployment-plan.json");
const launchpad = await readJson<{ chainId: number; nextNonce: number; gates: { broadcastAllowed: boolean } }>("deployments/elysium-testnet/launchpad-deployment-plan.json");
if (dbc.chainId !== 99_801 || launchpad.chainId !== 99_801 || launchpad.nextNonce !== 43 || dbc.gates.broadcastAllowed || launchpad.gates.broadcastAllowed) throw new Error("ELYSIUM_PROTECTED_PLAN_CONTEXT_INVALID");

const names = ["LaunchProtectionPolicyRegistry", "ProtectedLPAllocationEscrow", "ProtectedLaunchIdentityRegistry", "ProtectedLaunchFactory", "ProtectedLaunchRouter", "ProtectedGraduationManager", "ProtectedLaunchTokenDeployer", "ProtectedVirtualPoolDeployer", "LaunchConfigRegistry", "ERC1967Proxy"] as const;
const artifacts = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await load(name)] as const))) as Record<string, Artifact>;
const artifact = (name: string) => {
  const value = artifacts[name];
  if (!value?.bytecode.object || value.bytecode.object === "0x") throw new Error(`ELYSIUM_PROTECTED_ARTIFACT_MISSING:${name}`);
  return value;
};
const order = ["policyRegistryImplementation", "policyRegistry", "lpEscrowImplementation", "lpEscrow", "identityRegistryImplementation", "identityRegistry", "tokenDeployer", "virtualPoolDeployer", "factoryImplementation", "factory", "routerImplementation", "router", "graduationManagerImplementation", "graduationManager"] as const;
const addresses = Object.fromEntries(order.map((name, index) => [name, getContractAddress({ from: getAddress(dbc.deployer), nonce: BigInt(launchpad.nextNonce + index) })])) as Record<(typeof order)[number], Address>;
const init = (name: string, args: readonly unknown[]): Hex => encodeFunctionData({ abi: artifact(name).abi, functionName: "initialize", args });
const initializer = {
  policyRegistry: init("LaunchProtectionPolicyRegistry", [dbc.governance, dbc.upgrader, dbc.governance]),
  lpEscrow: init("ProtectedLPAllocationEscrow", [dbc.governance, dbc.upgrader]),
  identityRegistry: init("ProtectedLaunchIdentityRegistry", [dbc.governance, dbc.upgrader, addresses.factory]),
  factory: init("ProtectedLaunchFactory", [dbc.governance, dbc.upgrader, dbc.addresses.configRegistry, addresses.policyRegistry, addresses.tokenDeployer, addresses.virtualPoolDeployer, addresses.identityRegistry]),
  router: init("ProtectedLaunchRouter", [dbc.governance, dbc.upgrader, addresses.factory]),
  graduationManager: init("ProtectedGraduationManager", [dbc.governance, dbc.upgrader, addresses.factory, addresses.lpEscrow]),
};
const proxy = (implementation: Address, data: Hex): Hex => encodeDeployData({ abi: artifact("ERC1967Proxy").abi, bytecode: artifact("ERC1967Proxy").bytecode.object, args: [implementation, data] });
const deploymentData: Record<(typeof order)[number], Hex> = {
  policyRegistryImplementation: artifact("LaunchProtectionPolicyRegistry").bytecode.object,
  policyRegistry: proxy(addresses.policyRegistryImplementation, initializer.policyRegistry),
  lpEscrowImplementation: artifact("ProtectedLPAllocationEscrow").bytecode.object,
  lpEscrow: proxy(addresses.lpEscrowImplementation, initializer.lpEscrow),
  identityRegistryImplementation: artifact("ProtectedLaunchIdentityRegistry").bytecode.object,
  identityRegistry: proxy(addresses.identityRegistryImplementation, initializer.identityRegistry),
  tokenDeployer: encodeDeployData({ abi: artifact("ProtectedLaunchTokenDeployer").abi, bytecode: artifact("ProtectedLaunchTokenDeployer").bytecode.object, args: [dbc.governance] }),
  virtualPoolDeployer: encodeDeployData({ abi: artifact("ProtectedVirtualPoolDeployer").abi, bytecode: artifact("ProtectedVirtualPoolDeployer").bytecode.object, args: [dbc.governance] }),
  factoryImplementation: artifact("ProtectedLaunchFactory").bytecode.object,
  factory: proxy(addresses.factoryImplementation, initializer.factory),
  routerImplementation: artifact("ProtectedLaunchRouter").bytecode.object,
  router: proxy(addresses.routerImplementation, initializer.router),
  graduationManagerImplementation: artifact("ProtectedGraduationManager").bytecode.object,
  graduationManager: proxy(addresses.graduationManagerImplementation, initializer.graduationManager),
};
const role = (name: string): Hex => keccak256(new TextEncoder().encode(name));
const call = (description: string, target: Address, abiName: string, functionName: string, args: readonly unknown[]) => ({ description, target, data: encodeFunctionData({ abi: artifact(abiName).abi, functionName, args }) });
const governanceCalls = [
  call("Bind Protected token deployer", addresses.tokenDeployer, "ProtectedLaunchTokenDeployer", "bindFactory", [addresses.factory]),
  call("Bind Protected pool deployer", addresses.virtualPoolDeployer, "ProtectedVirtualPoolDeployer", "bindFactory", [addresses.factory]),
  call("Authorize Protected factory on DBC template registry", dbc.addresses.configRegistry, "LaunchConfigRegistry", "setRole", [role("ZKBLAST_FACTORY_ROLE"), addresses.factory, true]),
  call("Authorize Protected factory on policy registry", addresses.policyRegistry, "LaunchProtectionPolicyRegistry", "setRole", [role("ZKBLAST_PROTECTION_POLICY_CONSUMER_ROLE"), addresses.factory, true]),
  call("Authorize Protected graduation manager on LP escrow", addresses.lpEscrow, "ProtectedLPAllocationEscrow", "setRole", [role("ZKBLAST_PROTECTED_GRADUATION_MANAGER_ROLE"), addresses.graduationManager, true]),
  call("Bind Protected graduation manager to factory", addresses.factory, "ProtectedLaunchFactory", "setGraduationManager", [addresses.graduationManager]),
];
const deploymentStart = launchpad.nextNonce;
const governanceStart = deploymentStart + order.length;
const unsignedPlan = {
  schemaVersion: 1,
  kind: "elysium-protected-launch-deployment-plan",
  generatedAt: new Date().toISOString(),
  chainId: 99_801,
  deployer: dbc.deployer,
  governance: dbc.governance,
  upgrader: dbc.upgrader,
  startingNonce: deploymentStart,
  deploymentTransactionCount: order.length,
  governanceTransactionCount: governanceCalls.length,
  transactionCount: order.length + governanceCalls.length,
  nextNonce: governanceStart + governanceCalls.length,
  dependencies: { templateRegistry: dbc.addresses.configRegistry, graduationAdapter: null },
  addresses,
  deployments: order.map((name, index) => ({ name, nonce: deploymentStart + index, predictedContractAddress: addresses[name], data: deploymentData[name], dataHash: keccak256(deploymentData[name]), dataBytes: (deploymentData[name].length - 2) / 2 })),
  initializerHashes: Object.fromEntries(Object.entries(initializer).map(([name, data]) => [name, keccak256(data)])),
  governanceCalls: governanceCalls.map((item, index) => ({ ...item, nonce: governanceStart + index, dataHash: keccak256(item.data) })),
  capabilities: { protectedLaunch: true, graduation: false, graduationStatus: "pending-adapter" },
  gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false },
};
const plan = { ...unsignedPlan, planSha256: createHash("sha256").update(JSON.stringify(unsignedPlan)).digest("hex") };
await mkdir(path.join(directory, "protected-launch"), { recursive: true });
await writeFile(path.join(directory, "protected-launch/deployment-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: plan.transactionCount, startingNonce: plan.startingNonce, nextNonce: plan.nextNonce, protectedFactory: addresses.factory, planSha256: plan.planSha256, broadcastAllowed: false }, null, 2));
