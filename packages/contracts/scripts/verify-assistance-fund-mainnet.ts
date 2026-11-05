import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, fallback, getAddress, http, keccak256, parseAbi, type Address, type Hex } from "viem";

type Plan = Readonly<{
  planSha256: string;
  chainId: number;
  governance: Address;
  upgrader: Address;
  protocolToken: Address;
  addresses: Record<string, Address>;
  deployments: ReadonlyArray<{ name: string; predictedContractAddress: Address }>;
}>;
type Receipt = Readonly<{ blockNumber: string; transactionHash: Hex }>;
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/mainnet/assistance-fund");
const plan = JSON.parse(await readFile(path.join(directory, "deployment-plan.json"), "utf8")) as Plan;
const receipts = JSON.parse(await readFile(path.join(directory, "deployment-execution.json"), "utf8")) as Receipt[];
const urls = [...new Set([
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "").split(",").map((value) => value.trim()),
].filter((value): value is string => Boolean(value)))];
if (urls.length === 0) throw new Error("RPC_URL_REQUIRED");
const client = createPublicClient({ transport: fallback(urls.map((url) => http(url, { timeout: 30_000, retryCount: 1 })), { rank: true }) });
assert.equal(await client.getChainId(), 4663, "Chain mismatch");

const codeHashes: Record<string, Hex> = {};
for (const deployment of plan.deployments) {
  const code = await client.getCode({ address: deployment.predictedContractAddress });
  assert(code && code !== "0x", `Missing code: ${deployment.name}`);
  codeHashes[deployment.name] = keccak256(code);
}
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const proxyPairs = [
  ["registry", "registryImplementation"],
  ["collector", "collectorImplementation"],
  ["treasuryController", "treasuryControllerImplementation"],
  ["routeRegistry", "routeRegistryImplementation"],
  ["executor", "executorImplementation"],
] as const;
for (const [proxy, implementation] of proxyPairs) {
  const stored = await client.getStorageAt({ address: plan.addresses[proxy]!, slot: implementationSlot });
  assert(stored, `Missing implementation slot: ${proxy}`);
  assert.equal(getAddress(`0x${stored.slice(-40)}`), getAddress(plan.addresses[implementation]!), `Implementation mismatch: ${proxy}`);
}
const views = parseAbi([
  "function treasuryController() view returns (address)",
  "function buybackExecutor() view returns (address)",
  "function assistanceFund() view returns (address)",
  "function collector() view returns (address)",
  "function routeRegistry() view returns (address)",
  "function burnModule() view returns (address)",
  "function protocolToken() view returns (address)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
assert.equal(getAddress(await client.readContract({ address: plan.addresses.collector!, abi: views, functionName: "treasuryController" })), getAddress(plan.addresses.treasuryController!));
assert.equal(getAddress(await client.readContract({ address: plan.addresses.collector!, abi: views, functionName: "buybackExecutor" })), getAddress(plan.addresses.executor!));
assert.equal(getAddress(await client.readContract({ address: plan.addresses.burnModule!, abi: views, functionName: "assistanceFund" })), getAddress(plan.addresses.executor!));
for (const [functionName, expected] of [
  ["collector", plan.addresses.collector],
  ["routeRegistry", plan.addresses.routeRegistry],
  ["burnModule", plan.addresses.burnModule],
  ["protocolToken", plan.protocolToken],
] as const) {
  assert.equal(getAddress(await client.readContract({ address: plan.addresses.executor!, abi: views, functionName })), getAddress(expected!));
}
const upgraderRole = keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE"));
for (const target of ["registry", "collector", "treasuryController", "routeRegistry", "executor"] as const) {
  assert.equal(await client.readContract({ address: plan.addresses[target]!, abi: views, functionName: "hasRole", args: [upgraderRole, plan.upgrader] }), true, `Upgrader role missing: ${target}`);
}
const reportWithoutHash = {
  schemaVersion: 1,
  feature: "zkblast-assistance-fund",
  chainId: plan.chainId,
  planSha256: plan.planSha256,
  deploymentBlock: Math.min(...receipts.map((receipt) => Number(receipt.blockNumber))),
  latestBlock: Number(await client.getBlockNumber()),
  codeHashes,
  checks: {
    deployedCode: true,
    proxyImplementationSlots: true,
    collectorBindings: true,
    burnBinding: true,
    executorBindings: true,
    upgraderRoles: true,
    sourcesRegistered: 0,
    routesEnabled: 0,
  },
  transactionHashes: receipts.map((receipt) => receipt.transactionHash),
};
const reportSha256 = createHash("sha256").update(JSON.stringify(reportWithoutHash)).digest("hex");
const report = { ...reportWithoutHash, reportSha256 };
const outputPath = path.join(directory, "deployment-verification.json");
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ outputPath, deploymentBlock: report.deploymentBlock, latestBlock: report.latestBlock, reportSha256, passed: true }, null, 2));
