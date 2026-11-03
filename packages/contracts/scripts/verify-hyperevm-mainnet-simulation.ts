import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, toHex, zeroHash, type Abi, type Address } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const rpcUrl = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18599";
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, "deployments/hyperevm-mainnet", file), "utf8")) as T;
const artifactAbi = async (name: string): Promise<Abi> => (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const core = await read<{ governance: Address; upgrader: Address; addresses: Record<string, Address> }>("core-deployment-plan.json");
const dbc = await read<{ addresses: Record<string, Address> }>("dbc-deployment-plan.json");
const launchpad = await read<{ addresses: Record<string, Address> }>("launchpad-deployment-plan.json");
const adapter = await read<{ addresses: Record<string, Address> }>("adapter-registry-deployment-plan.json");
const address = (values: Record<string, Address>, name: string): Address => {
  const value = values[name];
  if (!value) throw new Error(`HYPEREVM_SIMULATION_ADDRESS_MISSING:${name}`);
  return getAddress(value);
};
const simulation = await read<{ transactionCount: number; totalGasUsed: string }>("sequential-simulation.json");
if (simulation.transactionCount !== 56) throw new Error("HYPEREVM_SIMULATION_RECEIPTS_INCOMPLETE");
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_SIMULATION_CHAIN_MISMATCH");
const allAddresses = [core.addresses, dbc.addresses, launchpad.addresses, adapter.addresses]
  .flatMap((values) => Object.values(values))
  .map((value) => getAddress(value));
const codes = await Promise.all(allAddresses.map((address) => client.getCode({ address })));
if (codes.some((code) => !code || code === "0x")) throw new Error("HYPEREVM_SIMULATION_CODE_MISSING");
const accessAbi = await artifactAbi("PoolRegistry");
const defaultAdminRole = zeroHash;
const upgraderRole = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
const proxies = [[core.addresses, "poolRegistry"], [core.addresses, "poolFactory"], [core.addresses, "swapRouter"], [core.addresses, "positionManager"], [dbc.addresses, "configRegistry"], [dbc.addresses, "launchFactory"], [dbc.addresses, "launchpadRouter"], [dbc.addresses, "lpAllocationEscrow"], [dbc.addresses, "graduationManager"], [launchpad.addresses, "registry"], [launchpad.addresses, "configManager"], [launchpad.addresses, "factory"], [launchpad.addresses, "feeController"], [launchpad.addresses, "revenueSplitter"], [launchpad.addresses, "feeCollector"], [launchpad.addresses, "tokenFactory"], [adapter.addresses, "registry"]].map(([values, name]) => address(values as Record<string, Address>, name as string));
for (const address of proxies) {
  const [admin, upgrader] = await Promise.all([
    client.readContract({ address, abi: accessAbi, functionName: "hasRole", args: [defaultAdminRole, core.governance] }),
    client.readContract({ address, abi: accessAbi, functionName: "hasRole", args: [upgraderRole, core.upgrader] }),
  ]);
  if (!admin || !upgrader) throw new Error(`HYPEREVM_SIMULATION_ROLE_INVALID:${address}`);
}
const timelockAbi = [{ type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
const poolFactoryAbi = await artifactAbi("PoolFactory"), launchFactoryAbi = await artifactAbi("LaunchFactory"), launchpadFactoryAbi = await artifactAbi("LaunchpadFactory"), registryAbi = await artifactAbi("LaunchConfigRegistry"), adapterRegistryAbi = await artifactAbi("GraduationAdapterRegistry");
const timelockAddress = address(core.addresses, "timelock"), poolFactoryAddress = address(core.addresses, "poolFactory"), poolRegistryAddress = address(core.addresses, "poolRegistry");
const dbcFactoryAddress = address(dbc.addresses, "launchFactory"), dbcRegistryAddress = address(dbc.addresses, "configRegistry"), tokenDeployerAddress = address(dbc.addresses, "launchTokenDeployer"), poolDeployerAddress = address(dbc.addresses, "virtualPoolDeployer");
const launchpadFactoryAddress = address(launchpad.addresses, "factory"), launchpadRegistryAddress = address(launchpad.addresses, "registry"), configManagerAddress = address(launchpad.addresses, "configManager"), adapterRegistryAddress = address(adapter.addresses, "registry");
const [delay, poolRegistry, launchRegistry, tokenDeployer, poolDeployer, launchpadRegistry, configManager, adapterChainId, templateCount, whypeAllowed] = await Promise.all([
  client.readContract({ address: timelockAddress, abi: timelockAbi, functionName: "getMinDelay" }),
  client.readContract({ address: poolFactoryAddress, abi: poolFactoryAbi, functionName: "registry" }),
  client.readContract({ address: dbcFactoryAddress, abi: launchFactoryAbi, functionName: "registry" }),
  client.readContract({ address: dbcFactoryAddress, abi: launchFactoryAbi, functionName: "tokenDeployer" }),
  client.readContract({ address: dbcFactoryAddress, abi: launchFactoryAbi, functionName: "poolDeployer" }),
  client.readContract({ address: launchpadFactoryAddress, abi: launchpadFactoryAbi, functionName: "registry" }),
  client.readContract({ address: launchpadFactoryAddress, abi: launchpadFactoryAbi, functionName: "configManager" }),
  client.readContract({ address: adapterRegistryAddress, abi: adapterRegistryAbi, functionName: "registryChainId" }),
  client.readContract({ address: dbcRegistryAddress, abi: registryAbi, functionName: "templateCount" }),
  client.readContract({ address: dbcRegistryAddress, abi: registryAbi, functionName: "quoteTokenAllowed", args: ["0x5555555555555555555555555555555555555555"] }),
]);
const equal = (left: unknown, right: Address) => getAddress(String(left)) === getAddress(right);
if (delay !== 300n || !equal(poolRegistry, poolRegistryAddress) || !equal(launchRegistry, dbcRegistryAddress) || !equal(tokenDeployer, tokenDeployerAddress) || !equal(poolDeployer, poolDeployerAddress) || !equal(launchpadRegistry, launchpadRegistryAddress) || !equal(configManager, configManagerAddress) || adapterChainId !== 999n || templateCount !== 1n || !whypeAllowed) throw new Error("HYPEREVM_SIMULATION_BINDING_INVALID");
const report = { schemaVersion: 1, chainId: 999, verifiedAt: new Date().toISOString(), transactionCount: simulation.transactionCount, totalGasUsed: simulation.totalGasUsed, codeAddressCount: allAddresses.length, proxyRoleChecks: proxies.length, checks: { timelockDelaySeconds: delay.toString(), poolRegistryBinding: true, dbcDeployerBindings: true, launchpadBindings: true, adapterRegistryChainId: adapterChainId.toString(), candidateTemplateCount: templateCount.toString(), whypeAllowed: true }, passed: true };
await writeFile(path.join(root, "deployments/hyperevm-mainnet/sequential-simulation-verification.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(report, null, 2));
