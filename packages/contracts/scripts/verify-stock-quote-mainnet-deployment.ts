import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, type Abi, type Address, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(await readFile(
  path.join(root, "deployments/mainnet/stock-quotes/deployment-plan.json"),
  "utf8",
));
const execution = JSON.parse(await readFile(
  path.join(root, "deployments/mainnet/stock-quotes/deployment-execution.json"),
  "utf8",
));
assert.equal(execution.status, "transactions-complete");
assert.equal(execution.planSha256, plan.planSha256);
assert.equal(execution.receipts.length, 18);
const fallbacks = (process.env.RPC_FALLBACK_URLS?.split(",") ?? []).map((value) => value.trim()).filter(Boolean);
const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || fallbacks[1] || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }) });
assert.equal(await client.getChainId(), 4663);
const artifact = async (name: string) => JSON.parse(await readFile(
  path.join(root, "packages/contracts/out-hyperevm", `${name}.sol`, `${name}.json`),
  "utf8",
)) as { abi: Abi };
const [adapterArtifact, assetArtifact, destinationArtifact] = await Promise.all([
  artifact("GraduationAdapterRegistry"),
  artifact("StockQuoteAssetRegistry"),
  artifact("StockQuoteDestinationRegistry"),
]);
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
async function implementation(proxy: Address) {
  const stored = await client.getStorageAt({ address: getAddress(proxy), slot: implementationSlot });
  assert(stored, `IMPLEMENTATION_SLOT_EMPTY:${proxy}`);
  return getAddress(`0x${stored.slice(-40)}`);
}
const proxyBindings = [
  [plan.addresses.adapterRegistry, plan.addresses.adapterRegistryImplementation],
  [plan.addresses.assetRegistry, plan.addresses.assetRegistryImplementation],
  [plan.addresses.oracleGuard, plan.addresses.oracleGuardImplementation],
  [plan.addresses.destinationRegistry, plan.addresses.destinationRegistryImplementation],
  ["0x98D8546bb60d4d5fF791fB6b904A611691D86beF", plan.addresses.protectedLaunchFactoryImplementation],
  ["0xE83203279e4e8Db4Aa747213aC28260418Ff2E83", plan.addresses.protectedGraduationManagerImplementation],
] as const;
for (const [proxy, expected] of proxyBindings) {
  assert.equal(await implementation(proxy), getAddress(expected), `IMPLEMENTATION_MISMATCH:${proxy}`);
}
for (const deployment of plan.deployments) {
  const code = await client.getCode({ address: getAddress(deployment.predictedContractAddress) });
  assert(code && code !== "0x", `DEPLOYED_CODE_MISSING:${deployment.name}`);
}
const managerRegistry = await client.readContract({
  address: getAddress("0xE83203279e4e8Db4Aa747213aC28260418Ff2E83"),
  abi: [{ type: "function", name: "stockQuoteDestinationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
  functionName: "stockQuoteDestinationRegistry",
});
assert.equal(getAddress(managerRegistry), getAddress(plan.addresses.destinationRegistry));
const executionGuard = await client.readContract({
  address: getAddress("0x98D8546bb60d4d5fF791fB6b904A611691D86beF"),
  abi: [{ type: "function", name: "quoteExecutionGuard", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }],
  functionName: "quoteExecutionGuard",
  args: [getAddress(plan.canaryAsset)],
});
assert.equal(getAddress(executionGuard), getAddress(plan.addresses.oracleGuard));
const assetConfig = await client.readContract({
  address: getAddress(plan.addresses.assetRegistry),
  abi: assetArtifact.abi,
  functionName: "quoteAssetConfig",
  args: [getAddress(plan.canaryAsset)],
}) as { enabled: boolean; quoteTradingEnabled: boolean; graduationEnabled: boolean };
assert.equal(assetConfig.enabled, false);
assert.equal(assetConfig.quoteTradingEnabled, false);
assert.equal(assetConfig.graduationEnabled, false);
const [dammAdapterEnabled, dlmmAdapterEnabled, dammEnabled, dlmmEnabled] = await Promise.all([
  client.readContract({ address: getAddress(plan.addresses.adapterRegistry), abi: adapterArtifact.abi, functionName: "isEnabled", args: [getAddress("0x4D78A76696b4AdB62aC1843Fb9ddB2E2312E5910"), 1] }),
  client.readContract({ address: getAddress(plan.addresses.adapterRegistry), abi: adapterArtifact.abi, functionName: "isEnabled", args: [getAddress("0x28A31686370Fd1490EDB2C7221f7C3c46847d835"), 1] }),
  client.readContract({ address: getAddress(plan.addresses.destinationRegistry), abi: destinationArtifact.abi, functionName: "isEnabled", args: [getAddress(plan.canaryAsset), 0] }),
  client.readContract({ address: getAddress(plan.addresses.destinationRegistry), abi: destinationArtifact.abi, functionName: "isEnabled", args: [getAddress(plan.canaryAsset), 1] }),
]);
assert.equal(dammAdapterEnabled, true);
assert.equal(dlmmAdapterEnabled, true);
assert.equal(dammEnabled, false);
assert.equal(dlmmEnabled, false);
const verification = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  planSha256: plan.planSha256,
  verifiedAt: new Date().toISOString(),
  transactions: execution.receipts.length,
  totalFeeWei: execution.totalFeeWei,
  totalFeeEth: execution.totalFeeEth,
  proxyBindings: Object.fromEntries(proxyBindings.map(([proxy, expected]) => [getAddress(proxy), getAddress(expected)])),
  assertions: {
    allDeploymentCodePresent: true,
    allProxyImplementationsMatch: true,
    managerDestinationRegistryBound: true,
    canaryExecutionGuardBound: true,
    dammAdapterRegistered: true,
    dlmmAdapterRegistered: true,
    quoteTradingEnabled: false,
    graduationEnabled: false,
    dammEnabled: false,
    dlmmEnabled: false,
  },
};
await writeFile(
  path.join(root, "deployments/mainnet/stock-quotes/deployment-verification.json"),
  `${JSON.stringify(verification, null, 2)}\n`,
);
console.log(JSON.stringify(verification, null, 2));
