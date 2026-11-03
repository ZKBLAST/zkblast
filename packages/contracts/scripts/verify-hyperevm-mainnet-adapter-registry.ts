import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, stringToBytes, type Address, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-plan.json"), "utf8")) as { chainId: number; planSha256: string; governance: Address; upgrader: Address; addresses: { implementation: Address; registry: Address }; adapterRegistration: { planned: boolean; reason: string } };
const journal = JSON.parse(await readFile(path.join(directory, "adapter-registry-broadcast.private.json"), "utf8")) as { planSha256: string; transactions: Array<{ nonce: number; hash: Hex; state: string; blockNumber: string; gasUsed: string }> };
if (plan.chainId !== 999 || plan.planSha256 !== journal.planSha256 || journal.transactions.length !== 2 || journal.transactions.some((tx) => tx.state !== "confirmed")) throw new Error("HYPEREVM_ADAPTER_REGISTRY_VERIFY_EVIDENCE_INVALID");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_ADAPTER_REGISTRY_VERIFY_CHAIN_INVALID");
const implementation = getAddress(plan.addresses.implementation), registry = getAddress(plan.addresses.registry);
const [implementationCode, registryCode, registryChainId] = await Promise.all([
  client.getCode({ address: implementation }), client.getCode({ address: registry }),
  client.readContract({ address: registry, abi: [{ type: "function", name: "registryChainId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }], functionName: "registryChainId" }),
]);
if (!implementationCode || implementationCode === "0x" || !registryCode || registryCode === "0x" || registryChainId !== 999n) throw new Error("HYPEREVM_ADAPTER_REGISTRY_STATE_INVALID");
const roleAbi = [{ type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] }] as const;
const adminRole = `0x${"00".repeat(32)}` as Hex, upgraderRole = keccak256(stringToBytes("ZKBLAST_UPGRADER_ROLE"));
const [adminEnabled, upgraderEnabled] = await Promise.all([
  client.readContract({ address: registry, abi: roleAbi, functionName: "hasRole", args: [adminRole, getAddress(plan.governance)] }),
  client.readContract({ address: registry, abi: roleAbi, functionName: "hasRole", args: [upgraderRole, getAddress(plan.upgrader)] }),
]);
if (!adminEnabled || !upgraderEnabled) throw new Error("HYPEREVM_ADAPTER_REGISTRY_ROLE_INVALID");
const manifest = { schemaVersion: 1, environment: "mainnet", network: "hyperevm", chainId: 999, verifiedAt: new Date().toISOString(), verifiedBlock: (await client.getBlockNumber()).toString(), planSha256: plan.planSha256, addresses: { implementation, registry }, governance: getAddress(plan.governance), upgrader: getAddress(plan.upgrader), adapterRegistration: plan.adapterRegistration, transactions: journal.transactions.map(({ nonce, hash, blockNumber, gasUsed }) => ({ nonce, hash, blockNumber, gasUsed })), checks: { implementationCodePresent: true, proxyCodePresent: true, registryChainId: registryChainId.toString(), governanceAdminRole: adminEnabled, timelockUpgraderRole: upgraderEnabled, adapterRecordCreated: false } };
await writeFile(path.join(directory, "adapter-registry-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ passed: true, verifiedBlock: manifest.verifiedBlock, addressChecks: 2, roleChecks: 2, registryChainId: manifest.checks.registryChainId, adapterRecordCreated: false, manifest: "deployments/hyperevm-mainnet/adapter-registry-manifest.json" }, null, 2));
