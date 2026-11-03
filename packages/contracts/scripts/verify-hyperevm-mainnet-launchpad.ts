import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, parseAbi, type Address, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "launchpad-deployment-plan.json"), "utf8")) as {
  chainId: number;
  deployer: Address;
  planSha256: string;
  addresses: Record<string, Address>;
  dependencies: Record<string, Address>;
  governance: Address;
  upgrader: Address;
  capabilities: Record<string, boolean>;
  deployments: Array<{ name: string; predictedContractAddress: Address }>;
  configurations: Array<{ description: string; target: Address; data: Hex }>;
};
const journal = JSON.parse(await readFile(path.join(directory, "launchpad-broadcast.private.json"), "utf8")) as {
  planSha256: string;
  transactions: Array<{ nonce: number; hash: Hex; state: string; blockNumber: string; gasUsed: string; effectiveGasPrice: string }>;
};
if (plan.chainId !== 999 || journal.planSha256 !== plan.planSha256 || journal.transactions.length !== 21) {
  throw new Error("HYPEREVM_LAUNCHPAD_VERIFY_EVIDENCE_INVALID");
}
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_LAUNCHPAD_VERIFY_CHAIN_INVALID");

const codeChecks = await Promise.all(plan.deployments.map(async (deployment) => ({
  name: deployment.name,
  address: getAddress(deployment.predictedContractAddress),
  present: (await client.getCode({ address: getAddress(deployment.predictedContractAddress) })) !== "0x",
})));
if (codeChecks.some((check) => !check.present)) throw new Error("HYPEREVM_LAUNCHPAD_CODE_MISSING");

const hasRoleAbi = [{
  type: "function", name: "hasRole", stateMutability: "view",
  inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;
const roleChecks = await Promise.all(plan.configurations.map(async (configuration) => {
  const role = `0x${configuration.data.slice(10, 74)}` as Hex;
  const account = getAddress(`0x${configuration.data.slice(98, 138)}`);
  const enabled = await client.readContract({ address: getAddress(configuration.target), abi: hasRoleAbi, functionName: "hasRole", args: [role, account] });
  return { description: configuration.description, target: getAddress(configuration.target), role, account, enabled };
}));
if (roleChecks.some((check) => !check.enabled)) throw new Error("HYPEREVM_LAUNCHPAD_ROLE_MISSING");

const addr = (key: string) => {
  const value = plan.addresses[key];
  if (!value) throw new Error(`HYPEREVM_LAUNCHPAD_ADDRESS_MISSING:${key}`);
  return getAddress(value);
};
const dep = (key: string) => {
  const value = plan.dependencies[key];
  if (!value) throw new Error(`HYPEREVM_LAUNCHPAD_DEPENDENCY_MISSING:${key}`);
  return getAddress(value);
};
const getterAbi = parseAbi([
  "function registry() view returns (address)",
  "function configManager() view returns (address)",
  "function dbcFactory() view returns (address)",
  "function feeController() view returns (address)",
  "function revenueSplitter() view returns (address)",
  "function feeCollector() view returns (address)",
]);
const bindings = {
  factoryRegistry: await client.readContract({ address: addr("factory"), abi: getterAbi, functionName: "registry" }),
  factoryConfigManager: await client.readContract({ address: addr("factory"), abi: getterAbi, functionName: "configManager" }),
  tokenFactoryRegistry: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "registry" }),
  tokenFactoryConfigManager: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "configManager" }),
  tokenFactoryDbcFactory: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "dbcFactory" }),
  tokenFactoryFeeController: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "feeController" }),
  tokenFactoryRevenueSplitter: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "revenueSplitter" }),
  tokenFactoryFeeCollector: await client.readContract({ address: addr("tokenFactory"), abi: getterAbi, functionName: "feeCollector" }),
};
const expectedBindings: Record<keyof typeof bindings, Address> = {
  factoryRegistry: addr("registry"),
  factoryConfigManager: addr("configManager"),
  tokenFactoryRegistry: addr("registry"),
  tokenFactoryConfigManager: addr("configManager"),
  tokenFactoryDbcFactory: dep("dbcLaunchFactory"),
  tokenFactoryFeeController: addr("feeController"),
  tokenFactoryRevenueSplitter: addr("revenueSplitter"),
  tokenFactoryFeeCollector: addr("feeCollector"),
};
for (const key of Object.keys(bindings) as Array<keyof typeof bindings>) {
  if (getAddress(bindings[key]) !== getAddress(expectedBindings[key])) throw new Error(`HYPEREVM_LAUNCHPAD_BINDING_INVALID:${key}`);
}

const latestBlock = await client.getBlockNumber();
const manifest = {
  schemaVersion: 1,
  environment: "mainnet",
  network: "hyperevm",
  chainId: 999,
  verifiedAt: new Date().toISOString(),
  verifiedBlock: latestBlock.toString(),
  planSha256: plan.planSha256,
  deployer: getAddress(plan.deployer),
  governance: getAddress(plan.governance),
  upgrader: getAddress(plan.upgrader),
  addresses: Object.fromEntries(Object.entries(plan.addresses).map(([key, value]) => [key, getAddress(value)])),
  dependencies: Object.fromEntries(Object.entries(plan.dependencies).map(([key, value]) => [key, getAddress(value)])),
  capabilities: plan.capabilities,
  transactions: journal.transactions.map(({ nonce, hash, blockNumber, gasUsed }) => ({ nonce, hash, blockNumber, gasUsed })),
  checks: { code: codeChecks, roles: roleChecks, bindings },
};
await writeFile(path.join(directory, "launchpad-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ passed: true, verifiedBlock: manifest.verifiedBlock, addressChecks: codeChecks.length, roleChecks: roleChecks.length, bindingChecks: Object.keys(bindings).length, manifest: "deployments/hyperevm-mainnet/launchpad-manifest.json" }, null, 2));
