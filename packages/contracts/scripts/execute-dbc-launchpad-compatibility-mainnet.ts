import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
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
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const phase = process.argv.find((value) => value.startsWith("--phase="))?.split("=")[1];
assert(phase === "schedule" || phase === "finalize", "--phase must be schedule or finalize");
const capArgument = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArgument, "0.00037", "Execution cap differs from owner approval");
const cap = parseEther(capArgument);
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(key && /^0x[0-9a-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY is invalid");
const account = privateKeyToAccount(key as Hex);
const planPath = path.join(root, "deployments/mainnet/dbc-launchpad-compatibility-plan.json");
const evidencePath = path.join(root, "deployments/mainnet/dbc-launchpad-compatibility-execution.json");
const manifestPath = path.join(root, "deployments/mainnet/manifest.json");
const [plan, manifest] = await Promise.all([
  readFile(planPath, "utf8").then(JSON.parse),
  readFile(manifestPath, "utf8").then(JSON.parse),
]) as [any, any];
assert.equal(plan.broadcastAllowed, false);
assert.equal(account.address, getAddress(plan.deployer), "Deployer mismatch");
assert.equal(BigInt(plan.gas.feeCeilingWei) <= cap, true, "Planned fee ceiling exceeds approved cap");

type Build = { abi: Abi; bytecode: { object: Hex } };
const build = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Build;
const [factoryBuild, deployerBuild] = await Promise.all([build("LaunchFactory"), build("VirtualPoolDeployer")]);
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
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

type ReceiptRecord = {
  step: string;
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice: string;
  feeWei: string;
  contractAddress?: Address | null;
};
let previous: any = null;
try { previous = JSON.parse(await readFile(evidencePath, "utf8")); } catch { /* first phase */ }
const receipts: ReceiptRecord[] = previous?.transactions ?? [];
let spent = receipts.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const record = async (step: string, hash: Hex) => {
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${step} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `Actual fee exceeded cap after ${step}`);
  receipts.push({
    step,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
    ...(receipt.contractAddress !== undefined
      ? { contractAddress: receipt.contractAddress }
      : {}),
  });
  return receipt;
};
const guard = async (to: Address | undefined, data: Hex, step: string) => {
  const estimate = await client.estimateGas({ account, ...(to ? { to } : {}), data });
  const price = await client.getGasPrice();
  assert(spent + estimate * price * 2n <= cap, `Fee guard stopped before ${step}`);
};
const safeCall = async (to: Address, data: Hex, step: string) => {
  const operation = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.safe),
    to,
    data,
    relayer: account,
  });
  await guard(operation.to, operation.data, step);
  await record(step, await wallet.sendTransaction({ to: operation.to, data: operation.data }));
};
const save = async (status: "scheduled" | "confirmed", extra: Record<string, unknown> = {}) => {
  const evidence = {
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    status,
    approvedCapEth: capArgument,
    totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent),
    factory: plan.factory,
    previousImplementation: plan.currentImplementation,
    implementation: plan.newFactoryImplementation,
    previousPoolDeployer: plan.currentPoolDeployer,
    poolDeployer: plan.newPoolDeployer,
    timelock: plan.timelock,
    governanceSafe: plan.safe,
    operationId: plan.governance.operationId,
    transactions: receipts,
    ...extra,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
};

if (phase === "schedule") {
  assert(!previous, "Schedule evidence already exists; refusing duplicate execution");
  const [nonce, delay, balance, implementationCode, deployerCode] = await Promise.all([
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getMinDelay" }),
    client.getBalance({ address: account.address }),
    client.getCode({ address: getAddress(plan.newFactoryImplementation) }),
    client.getCode({ address: getAddress(plan.newPoolDeployer) }),
  ]);
  assert.equal(nonce, plan.deployerNonce, "Deployer nonce changed; regenerate plan");
  assert.equal(delay, 300n, "Timelock delay changed");
  assert(balance >= cap, "Deployer balance is below approved cap");
  assert(!implementationCode, "Predicted implementation address already contains code");
  assert(!deployerCode, "Predicted pool deployer address already contains code");

  const poolData = encodeDeployData({
    abi: deployerBuild.abi,
    bytecode: deployerBuild.bytecode.object,
    args: [getAddress(plan.safe)],
  });
  await guard(undefined, poolData, "deploy-virtual-pool-deployer");
  const poolReceipt = await record("deploy-virtual-pool-deployer", await wallet.deployContract({
    abi: deployerBuild.abi,
    bytecode: deployerBuild.bytecode.object,
    args: [getAddress(plan.safe)],
  }));
  assert.equal(getAddress(poolReceipt.contractAddress!), getAddress(plan.newPoolDeployer));

  await guard(undefined, factoryBuild.bytecode.object, "deploy-launch-factory-implementation");
  const implementationReceipt = await record(
    "deploy-launch-factory-implementation",
    await wallet.deployContract({ abi: factoryBuild.abi, bytecode: factoryBuild.bytecode.object }),
  );
  assert.equal(getAddress(implementationReceipt.contractAddress!), getAddress(plan.newFactoryImplementation));
  await safeCall(getAddress(plan.newPoolDeployer), plan.governance.bindData, "bind-new-deployer");
  await safeCall(getAddress(plan.timelock), plan.governance.scheduleData, "schedule-upgrade");
  const readyAt = await client.readContract({
    address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getTimestamp",
    args: [plan.governance.operationId],
  });
  assert(readyAt > 1n, "Timelock operation was not scheduled");
  console.log(JSON.stringify(await save("scheduled", { readyAt: readyAt.toString() })));
} else {
  assert(previous?.status === "scheduled", "Scheduled execution evidence is required");
  const [readyAt, doneBefore] = await Promise.all([
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "getTimestamp", args: [plan.governance.operationId] }),
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "isOperationDone", args: [plan.governance.operationId] }),
  ]);
  assert(!doneBefore, "Timelock operation is already complete");
  assert(BigInt(Math.floor(Date.now() / 1_000)) >= readyAt, `Timelock is not ready until ${readyAt}`);
  await safeCall(getAddress(plan.timelock), plan.governance.executeData, "execute-upgrade");
  await safeCall(getAddress(plan.factory), plan.governance.setPoolDeployerData, "rotate-pool-deployer");
  const [stored, livePoolDeployer, boundFactory, done] = await Promise.all([
    client.getStorageAt({ address: getAddress(plan.factory), slot: implementationSlot }),
    client.readContract({ address: getAddress(plan.factory), abi: factoryBuild.abi, functionName: "poolDeployer" }),
    client.readContract({ address: getAddress(plan.newPoolDeployer), abi: deployerBuild.abi, functionName: "factory" }),
    client.readContract({ address: getAddress(plan.timelock), abi: timelockAbi, functionName: "isOperationDone", args: [plan.governance.operationId] }),
  ]);
  assert(stored);
  assert.equal(getAddress(`0x${stored.slice(-40)}`), getAddress(plan.newFactoryImplementation));
  assert.equal(getAddress(livePoolDeployer as Address), getAddress(plan.newPoolDeployer));
  assert.equal(getAddress(boundFactory as Address), getAddress(plan.factory));
  assert(done, "Timelock operation is not complete");
  manifest.dbc.virtualPoolDeployer = getAddress(plan.newPoolDeployer);
  manifest.dbc.launchFactoryImplementation = getAddress(plan.newFactoryImplementation);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(await save("confirmed")));
}
