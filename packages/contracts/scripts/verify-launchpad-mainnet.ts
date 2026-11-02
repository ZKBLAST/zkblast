import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(await readFile(path.join(root, "deployments/mainnet/launchpad-v1-plan.json"), "utf8")) as any;
const execution = JSON.parse(await readFile(path.join(root, "deployments/mainnet/launchpad-v1-execution.json"), "utf8")) as any;
const manifestPath = path.join(root, "deployments/mainnet/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as any;
assert.equal(process.env.APP_ENV, "mainnet");
assert(process.env.RPC_URL);
assert.equal(plan.chainId, 4663);
assert.equal(execution.status, "transactions-complete");
assert.equal(execution.receipts.length, 21);

const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), 4663);
const safe = getAddress(plan.governance.admin);
const timelock = getAddress(plan.governance.upgrader);
const accessAbi = parseAbi(["function hasRole(bytes32,address) view returns(bool)"]);
const defaultAdminRole = `0x${"00".repeat(32)}` as Hex;
const upgraderRole = keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE"));
const factoryRole = keccak256(new TextEncoder().encode("ZKBLAST_FACTORY_ROLE"));
const accrualRole = keccak256(new TextEncoder().encode("ZKBLAST_LAUNCHPAD_FEE_ACCRUAL_ROLE"));
const dbcFactoryRole = keccak256(new TextEncoder().encode("ZKBLAST_DBC_LAUNCHPAD_FACTORY_ROLE"));
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const modules = ["registry", "configManager", "factory", "feeController", "revenueSplitter", "feeCollector", "tokenFactory"] as const;

const verifiedModules: Record<string, { proxy: Address; implementation: Address; runtimeHash: Hex }> = {};
for (const name of modules) {
  const proxy = getAddress(plan.addresses[name]);
  const implementation = getAddress(plan.addresses[`${name}Implementation`]);
  const [proxyCode, implementationCode, slot, adminRole, upgradeRole] = await Promise.all([
    client.getCode({ address: proxy }),
    client.getCode({ address: implementation }),
    client.getStorageAt({ address: proxy, slot: implementationSlot }),
    client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [defaultAdminRole, safe] }),
    client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [upgraderRole, timelock] }),
  ]);
  assert(proxyCode && implementationCode && slot, `${name} code or slot missing`);
  assert.equal(getAddress(`0x${slot.slice(-40)}`), implementation, `${name} implementation mismatch`);
  assert(adminRole && upgradeRole, `${name} authority mismatch`);
  verifiedModules[name] = { proxy, implementation, runtimeHash: keccak256(proxyCode) };
}
const lens = getAddress(plan.addresses.lens);
assert(await client.getCode({ address: lens }), "Lens runtime missing");

const roleChecks = {
  configFactory: await client.readContract({ address: getAddress(plan.addresses.configManager), abi: accessAbi, functionName: "hasRole", args: [factoryRole, getAddress(plan.addresses.factory)] }),
  dbcTokenFactory: await client.readContract({ address: getAddress(plan.dependencies.dbcLaunchFactory), abi: accessAbi, functionName: "hasRole", args: [dbcFactoryRole, getAddress(plan.addresses.tokenFactory)] }),
  feeControllerFactory: await client.readContract({ address: getAddress(plan.addresses.feeController), abi: accessAbi, functionName: "hasRole", args: [factoryRole, getAddress(plan.addresses.tokenFactory)] }),
  revenueFactory: await client.readContract({ address: getAddress(plan.addresses.revenueSplitter), abi: accessAbi, functionName: "hasRole", args: [factoryRole, getAddress(plan.addresses.tokenFactory)] }),
  collectorFactory: await client.readContract({ address: getAddress(plan.addresses.feeCollector), abi: accessAbi, functionName: "hasRole", args: [factoryRole, getAddress(plan.addresses.tokenFactory)] }),
  collectorAccrual: await client.readContract({ address: getAddress(plan.addresses.revenueSplitter), abi: accessAbi, functionName: "hasRole", args: [accrualRole, getAddress(plan.addresses.feeCollector)] }),
};
assert(Object.values(roleChecks).every(Boolean), "Role verification failed");
assert.equal(await client.getTransactionCount({ address: getAddress(plan.deployer), blockTag: "pending" }), 577, "Unexpected final deployer nonce");
const safeNonceAbi = parseAbi(["function nonce() view returns(uint256)"]);
assert.equal(await client.readContract({ address: safe, abi: safeNonceAbi, functionName: "nonce" }), 99n, "Unexpected final Safe nonce");
const verifiedModule = (name: (typeof modules)[number]) => {
  const value = verifiedModules[name];
  assert(value, `Verified module missing: ${name}`);
  return value;
};

manifest.launchpad = {
  abiVersion: 1,
  status: "contracts-active-services-pending",
  deploymentBlock: Number(execution.receipts[0].blockNumber),
  registry: verifiedModule("registry").proxy,
  configManager: verifiedModule("configManager").proxy,
  factory: verifiedModule("factory").proxy,
  feeController: verifiedModule("feeController").proxy,
  revenueSplitter: verifiedModule("revenueSplitter").proxy,
  feeCollector: verifiedModule("feeCollector").proxy,
  tokenFactory: verifiedModule("tokenFactory").proxy,
  lens,
  implementations: Object.fromEntries(Object.entries(verifiedModules).map(([name, value]) => [name, value.implementation])),
  capabilities: { permissionlessLaunchpads: true, permissionlessTokenLaunches: true, dammGraduation: true, dlmmGraduation: false, zkProofClaims: false },
  governance: { safe, timelock, delaySeconds: 300 },
  deploymentPlanSha256: execution.planSha256,
  transactions: execution.receipts.map((item: any) => ({ stage: item.stage, label: item.label, hash: item.transactionHash, blockNumber: Number(item.blockNumber), gasUsed: item.gasUsed, totalFeeWei: item.totalFeeWei })),
  totalFeeWei: execution.totalFeeWei,
};
manifest.generatedAt = new Date().toISOString();
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
execution.status = "verified";
execution.verifiedAt = new Date().toISOString();
execution.finalState = { deployerNonce: 577, safeNonce: 99, roleChecks };
await writeFile(path.join(root, "deployments/mainnet/launchpad-v1-execution.json"), `${JSON.stringify(execution, null, 2)}\n`);
console.log(JSON.stringify({ status: "verified", modules: modules.length, lens, roleChecks, totalFeeEth: execution.totalFeeEth }));
