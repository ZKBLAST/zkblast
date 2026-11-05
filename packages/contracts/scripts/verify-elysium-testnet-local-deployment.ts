import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type Plan = { addresses: Record<string, Address> };
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const read = async <T>(relativePath: string): Promise<T> => JSON.parse(await readFile(path.join(directory, relativePath), "utf8")) as T;
const dbc = await read<Plan>("dbc-deployment-plan.json");
const launchpad = await read<Plan>("launchpad-deployment-plan.json");
const protectedLaunch = await read<Plan>("protected-launch/deployment-plan.json");
const url = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18555";
let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
  if (payload.error) throw new Error(`${method}:${payload.error.code}:${payload.error.message}`);
  return payload.result as T;
}
if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== 99_801) throw new Error("ELYSIUM_LOCAL_VERIFY_CHAIN_INVALID");
const addressGroups = { dbc: dbc.addresses, launchpad: launchpad.addresses, protectedLaunch: protectedLaunch.addresses };
const codeChecks: Array<{ group: string; name: string; address: Address; runtimeBytes: number }> = [];
for (const [group, addresses] of Object.entries(addressGroups)) {
  for (const [name, address] of Object.entries(addresses)) {
    const code = await rpc<Hex>("eth_getCode", [address, "latest"]);
    if (!code || code === "0x") throw new Error(`ELYSIUM_LOCAL_VERIFY_CODE_MISSING:${group}:${name}`);
    codeChecks.push({ group, name, address: getAddress(address), runtimeBytes: (code.length - 2) / 2 });
  }
}
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const proxyPairs: Array<[string, Address, Address]> = [
  ["dbc.configRegistry", dbc.addresses.configRegistry, dbc.addresses.configRegistryImplementation],
  ["dbc.launchFactory", dbc.addresses.launchFactory, dbc.addresses.launchFactoryImplementation],
  ["dbc.launchpadRouter", dbc.addresses.launchpadRouter, dbc.addresses.launchpadRouterImplementation],
  ["dbc.lpAllocationEscrow", dbc.addresses.lpAllocationEscrow, dbc.addresses.lpAllocationEscrowImplementation],
  ["dbc.graduationManager", dbc.addresses.graduationManager, dbc.addresses.graduationManagerImplementation],
  ["launchpad.registry", launchpad.addresses.registry, launchpad.addresses.registryImplementation],
  ["launchpad.configManager", launchpad.addresses.configManager, launchpad.addresses.configManagerImplementation],
  ["launchpad.factory", launchpad.addresses.factory, launchpad.addresses.factoryImplementation],
  ["launchpad.feeController", launchpad.addresses.feeController, launchpad.addresses.feeControllerImplementation],
  ["launchpad.revenueSplitter", launchpad.addresses.revenueSplitter, launchpad.addresses.revenueSplitterImplementation],
  ["launchpad.feeCollector", launchpad.addresses.feeCollector, launchpad.addresses.feeCollectorImplementation],
  ["launchpad.tokenFactory", launchpad.addresses.tokenFactory, launchpad.addresses.tokenFactoryImplementation],
  ["protected.policyRegistry", protectedLaunch.addresses.policyRegistry, protectedLaunch.addresses.policyRegistryImplementation],
  ["protected.lpEscrow", protectedLaunch.addresses.lpEscrow, protectedLaunch.addresses.lpEscrowImplementation],
  ["protected.identityRegistry", protectedLaunch.addresses.identityRegistry, protectedLaunch.addresses.identityRegistryImplementation],
  ["protected.factory", protectedLaunch.addresses.factory, protectedLaunch.addresses.factoryImplementation],
  ["protected.router", protectedLaunch.addresses.router, protectedLaunch.addresses.routerImplementation],
  ["protected.graduationManager", protectedLaunch.addresses.graduationManager, protectedLaunch.addresses.graduationManagerImplementation],
];
for (const [name, proxy, implementation] of proxyPairs) {
  const stored = await rpc<Hex>("eth_getStorageAt", [proxy, implementationSlot, "latest"]);
  if (getAddress(`0x${stored.slice(-40)}`) !== getAddress(implementation)) throw new Error(`ELYSIUM_LOCAL_VERIFY_PROXY_MISMATCH:${name}`);
}
const nonce = Number(BigInt(await rpc<Hex>("eth_getTransactionCount", ["0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B", "pending"])));
if (nonce !== 63) throw new Error(`ELYSIUM_LOCAL_VERIFY_NONCE_INVALID:${nonce}`);
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), chainId: 99_801, nextNonce: nonce, codeChecks, proxyChecks: proxyPairs.map(([name, proxy, implementation]) => ({ name, proxy, implementation })), capabilities: { dbc: true, launchpad: true, protectedLaunch: true, graduation: false }, passed: true, broadcastAllowed: false };
await writeFile(path.join(directory, "local-post-deployment-verification.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ codeChecks: codeChecks.length, proxyChecks: proxyPairs.length, nextNonce: nonce, capabilities: report.capabilities, passed: true, broadcastAllowed: false }, null, 2));
