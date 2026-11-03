import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, toHex, zeroHash, type Abi, type Address } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const original = JSON.parse(await readFile(path.join(directory, "core-deployment-plan.json"), "utf8")) as { governance: Address; upgrader: Address; addresses: Record<string, Address> };
const first = JSON.parse(await readFile(path.join(directory, "broadcast-journal.private.json"), "utf8")) as { transactions: Array<Record<string, unknown>> };
const resumed = JSON.parse(await readFile(path.join(directory, "core-resume-broadcast.private.json"), "utf8")) as { planSha256: string; transactions: Array<Record<string, unknown>> };
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999 || await client.getTransactionCount({ address: getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B"), blockTag: "pending" }) !== 10) throw new Error("HYPEREVM_CORE_VERIFY_CONTEXT_INVALID");
const addresses = Object.fromEntries(Object.entries(original.addresses).map(([name, address]) => [name, getAddress(address)])) as Record<string, Address>;
const address = (name: string): Address => {
  const value = addresses[name];
  if (!value) throw new Error(`HYPEREVM_CORE_VERIFY_ADDRESS_MISSING:${name}`);
  return value;
};
const codes = await Promise.all(Object.values(addresses).map((address) => client.getCode({ address })));
if (codes.some((code) => !code || code === "0x")) throw new Error("HYPEREVM_CORE_VERIFY_CODE_MISSING");
const accessAbi = (JSON.parse(await readFile(path.join(root, "packages/contracts/out/PoolRegistry.sol/PoolRegistry.json"), "utf8")) as { abi: Abi }).abi;
const factoryAbi = (JSON.parse(await readFile(path.join(root, "packages/contracts/out/HyperEvmDammPoolFactory.sol/HyperEvmDammPoolFactory.json"), "utf8")) as { abi: Abi }).abi;
const adminRole = zeroHash, upgraderRole = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
for (const proxy of [address("poolRegistry"), address("poolFactory"), address("swapRouter"), address("positionManager")]) {
  const [admin, upgrader] = await Promise.all([
    client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [adminRole, original.governance] }),
    client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [upgraderRole, original.upgrader] }),
  ]);
  if (!admin || !upgrader) throw new Error(`HYPEREVM_CORE_VERIFY_ROLE_INVALID:${proxy}`);
}
const [registry, permissionless, delay] = await Promise.all([
  client.readContract({ address: address("poolFactory"), abi: factoryAbi, functionName: "registry" }),
  client.readContract({ address: address("poolFactory"), abi: factoryAbi, functionName: "permissionlessCreation" }),
  client.readContract({ address: address("timelock"), abi: [{ type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "getMinDelay" }),
]);
if (getAddress(String(registry)) !== address("poolRegistry") || permissionless !== true || delay !== 300n) throw new Error("HYPEREVM_CORE_VERIFY_BINDING_INVALID");
const transactions = [...first.transactions, ...resumed.transactions].map(({ nonce, name, hash, blockNumber, gasUsed, effectiveGasPrice, contractAddress }) => ({ nonce, name, hash, blockNumber, gasUsed, effectiveGasPrice, contractAddress }));
const manifest = { schemaVersion: 1, chainId: 999, environment: "mainnet", verifiedAt: new Date().toISOString(), deployer: "0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B", governance: original.governance, upgrader: original.upgrader, nextNonce: 10, capabilities: { damm: true, dlmm: false, dbc: false, launchpad: false, zk: false }, contracts: addresses, checks: { codeAddressCount: Object.keys(addresses).length, proxyRoleCount: 4, timelockDelaySeconds: "300", poolFactoryRegistryBinding: true, permissionlessPoolCreation: true }, sourcePlanSha256: resumed.planSha256, transactions };
await writeFile(path.join(directory, "core-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ chainId: 999, nextNonce: 10, transactionCount: transactions.length, codeAddressCount: manifest.checks.codeAddressCount, proxyRoleCount: 4, damm: true, dlmm: false, passed: true }, null, 2));
