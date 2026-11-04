import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const approvedPlanHash = "b8a1746c4a74a0c36b39dd632bbe51ca25484602f15602059dc918e592781711";
const approvedCap = "0.00025";
const phase = process.argv.find((value) => value.startsWith("--phase="))?.split("=")[1];
assert(phase === "schedule" || phase === "finalize", "--phase must be schedule or finalize");
assert.equal(process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1], approvedCap);
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(key && /^0x[\da-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY is invalid");
const account = privateKeyToAccount(key as Hex);
const planPath = path.join(root, "deployments/mainnet/protected-launchpad-binding-plan.json");
const evidencePath = path.join(root, "deployments/mainnet/protected-launchpad-binding-execution.json");
const manifestPath = path.join(root, "deployments/mainnet/manifest.json");
const planText = await readFile(planPath, "utf8");
assert.equal(createHash("sha256").update(planText).digest("hex"), approvedPlanHash, "Plan hash changed");
const plan = JSON.parse(planText) as any;
assert.equal(plan.broadcastAllowed, false);
assert.equal(getAddress(plan.deployer), account.address, "Deployer mismatch");
assert(BigInt(plan.gas.feeCeilingWei) <= parseEther(approvedCap), "Plan exceeds approved cap");

type Build = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const artifact = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Build;
const [tokenFactoryBuild, identityBuild] = await Promise.all([
  artifact("LaunchpadTokenFactory"),
  artifact("ProtectedLaunchIdentityRegistry"),
]);
assert.equal(plan.artifacts.tokenFactoryCreationCodeHash, (await import("viem")).keccak256(tokenFactoryBuild.bytecode.object));
assert.equal(plan.artifacts.identityCreationCodeHash, (await import("viem")).keccak256(identityBuild.bytecode.object));

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
assert.equal(await client.getChainId(), 4663);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationDone(bytes32) view returns (bool)",
]);
const accessAbi = parseAbi(["function hasRole(bytes32,address) view returns (bool)"]);
const tokenFactoryAbi = parseAbi(["function protectedFactory() view returns (address)"]);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

type ReceiptRecord = { step: string; hash: Hex; blockNumber: string; gasUsed: string; effectiveGasPrice: string; feeWei: string; contractAddress?: Address | null };
let previous: any = null;
try { previous = JSON.parse(await readFile(evidencePath, "utf8")); } catch { /* first phase */ }
const receipts: ReceiptRecord[] = previous?.transactions ?? [];
let spent = receipts.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const cap = parseEther(approvedCap);
const hasReceipt = (hash: Hex) => receipts.some((item) => item.hash.toLowerCase() === hash.toLowerCase());
const record = async (step: string, hash: Hex) => {
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${step} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `Actual fee exceeded cap after ${step}`);
  receipts.push({
    step, hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(), feeWei: fee.toString(),
    ...(receipt.contractAddress !== undefined ? { contractAddress: receipt.contractAddress } : {}),
  });
  return receipt;
};
const recover = async (step: string, hash: Hex) => {
  if (!hasReceipt(hash)) await record(step, hash);
};
const guard = async (to: Address | undefined, data: Hex, step: string) => {
  const estimate = await client.estimateGas({ account, ...(to ? { to } : {}), data });
  const price = await client.getGasPrice();
  assert(spent + estimate * price * 2n <= cap, `Fee guard stopped before ${step}`);
};
const safeCall = async (to: Address, data: Hex, step: string) => {
  const operation = await prepareSafeOperation(client, {
    chainId: 4663, safe: getAddress(plan.safe), to, data, relayer: account,
  });
  await guard(operation.to, operation.data, step);
  await record(step, await wallet.sendTransaction({ to: operation.to, data: operation.data }));
};
const save = async (status: "scheduled" | "confirmed", extra: Record<string, unknown> = {}) => {
  const evidence = {
    schemaVersion: 1, environment: "mainnet", chainId: 4663, status,
    approvedPlanHash, approvedCapEth: approvedCap, totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent), tokenFactory: plan.tokenFactory,
    protectedFactory: plan.protectedFactory, identityRegistry: plan.identityRegistry,
    newTokenFactoryImplementation: plan.newTokenFactoryImplementation,
    newIdentityImplementation: plan.newIdentityImplementation,
    operationId: plan.governance.operationId, transactions: receipts, ...extra,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
};

if (phase === "schedule") {
  assert(!previous, "Schedule evidence already exists");
  const [nonce, delay, balance, tokenCode, identityCode] = await Promise.all([
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getMinDelay" }),
    client.getBalance({ address: account.address }),
    client.getCode({ address: getAddress(plan.newTokenFactoryImplementation) }),
    client.getCode({ address: getAddress(plan.newIdentityImplementation) }),
  ]);
  assert.equal(nonce, plan.deployerNonce, "Deployer nonce changed; regenerate plan");
  assert.equal(delay, 300n, "Timelock delay changed");
  assert(balance >= cap, "Deployer balance is below approved cap");
  assert(!tokenCode && !identityCode, "Predicted implementation address already contains code");
  await guard(undefined, tokenFactoryBuild.bytecode.object, "deploy-token-factory-implementation");
  const tokenReceipt = await record("deploy-token-factory-implementation", await wallet.deployContract({
    abi: tokenFactoryBuild.abi, bytecode: tokenFactoryBuild.bytecode.object,
  }));
  assert.equal(getAddress(tokenReceipt.contractAddress!), getAddress(plan.newTokenFactoryImplementation));
  await guard(undefined, identityBuild.bytecode.object, "deploy-identity-implementation");
  const identityReceipt = await record("deploy-identity-implementation", await wallet.deployContract({
    abi: identityBuild.abi, bytecode: identityBuild.bytecode.object,
  }));
  assert.equal(getAddress(identityReceipt.contractAddress!), getAddress(plan.newIdentityImplementation));
  await safeCall(getAddress(plan.timelock), plan.governance.scheduleData, "schedule-batch-upgrade");
  const readyAt = await client.readContract({
    address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getTimestamp",
    args: [plan.governance.operationId],
  });
  assert(readyAt > 1n, "Timelock operation was not scheduled");
  console.log(JSON.stringify(await save("scheduled", { readyAt: readyAt.toString() })));
} else {
  assert(previous?.status === "scheduled", "Scheduled evidence is required");
  const readyAt = await client.readContract({
    address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getTimestamp",
    args: [plan.governance.operationId],
  });
  assert(BigInt(Math.floor(Date.now() / 1_000)) >= readyAt, `Timelock not ready until ${readyAt}`);
  // A provider may return `already known` after accepting a transaction. Reconcile
  // the accepted finalize transactions before deciding which state changes remain.
  await recover("execute-batch-upgrade", "0x15a434f577de4bc46a823f8f3c81f27ada4e9047dd394204c66dac5efddbf387");
  await recover("configure-protected-factory", "0x187ba6c5d646c42b0ee4f64f9bcc136fa4b6d1e478cb1415dce3ca1daabe4071");
  await recover("authorize-protected-factory", "0x058f2c046d0b35613f6a28e727abd95dcc107448a9731ea34d8721151bab1cc8");
  await recover("authorize-identity-binder", "0x13858573628d0022ba63eaa9e8e113442b219f191014bcb4ba5d155d9ce0a9aa");
  const factoryRoleId = (await import("viem")).keccak256(new TextEncoder().encode("ZKBLAST_PROTECTED_LAUNCHPAD_FACTORY_ROLE"));
  const binderRoleId = (await import("viem")).keccak256(new TextEncoder().encode("ZKBLAST_PROTECTED_LAUNCHPAD_BINDER_ROLE"));
  const [operationDone, configuredBefore, factoryRoleBefore, binderRoleBefore] = await Promise.all([
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "isOperationDone", args: [plan.governance.operationId] }),
    client.readContract({ address: getAddress(plan.tokenFactory), abi: tokenFactoryAbi, functionName: "protectedFactory" }),
    client.readContract({ address: getAddress(plan.protectedFactory), abi: accessAbi, functionName: "hasRole", args: [factoryRoleId, getAddress(plan.tokenFactory)] }),
    client.readContract({ address: getAddress(plan.identityRegistry), abi: accessAbi, functionName: "hasRole", args: [binderRoleId, getAddress(plan.tokenFactory)] }),
  ]);
  if (!operationDone) await safeCall(getAddress(plan.timelock), plan.governance.executeData, "execute-batch-upgrade");
  if (getAddress(configuredBefore as Address) !== getAddress(plan.protectedFactory)) {
    await safeCall(getAddress(plan.tokenFactory), plan.governance.setProtectedFactoryData, "configure-protected-factory");
  }
  if (!factoryRoleBefore) await safeCall(getAddress(plan.protectedFactory), plan.governance.authorizeFactoryData, "authorize-protected-factory");
  if (!binderRoleBefore) await safeCall(getAddress(plan.identityRegistry), plan.governance.authorizeBinderData, "authorize-identity-binder");
  const [tokenStored, identityStored, configuredFactory, factoryRole, binderRole, done] = await Promise.all([
    client.getStorageAt({ address: getAddress(plan.tokenFactory), slot: implementationSlot }),
    client.getStorageAt({ address: getAddress(plan.identityRegistry), slot: implementationSlot }),
    client.readContract({ address: getAddress(plan.tokenFactory), abi: tokenFactoryAbi, functionName: "protectedFactory" }),
    client.readContract({ address: getAddress(plan.protectedFactory), abi: accessAbi, functionName: "hasRole", args: [factoryRoleId, getAddress(plan.tokenFactory)] }),
    client.readContract({ address: getAddress(plan.identityRegistry), abi: accessAbi, functionName: "hasRole", args: [binderRoleId, getAddress(plan.tokenFactory)] }),
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "isOperationDone", args: [plan.governance.operationId] }),
  ]);
  assert(tokenStored && identityStored);
  assert.equal(getAddress(`0x${tokenStored.slice(-40)}`), getAddress(plan.newTokenFactoryImplementation));
  assert.equal(getAddress(`0x${identityStored.slice(-40)}`), getAddress(plan.newIdentityImplementation));
  assert.equal(getAddress(configuredFactory as Address), getAddress(plan.protectedFactory));
  assert(factoryRole && binderRole && done, "Final role or timelock verification failed");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.launchpad.implementations.tokenFactory = getAddress(plan.newTokenFactoryImplementation);
  manifest.protectedLaunch.identityRegistryImplementation = getAddress(plan.newIdentityImplementation);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(await save("confirmed", { factoryRole, binderRole, configuredFactory })));
}
