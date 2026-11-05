import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  stringToHex,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Plan = Readonly<{
  schemaVersion: 1;
  feature: "stock-quote-assets-damm-dlmm";
  environment: "mainnet";
  chainId: 4663;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  startingNonce: number;
  nextDeployerNonce: number;
  deployments: readonly Readonly<{
    name: string;
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
  }>[];
  calls: readonly Readonly<{
    actor: "governance" | "upgrader";
    description: string;
    target: Address;
    data: Hex;
  }>[];
  releaseState: Readonly<{
    quoteTradingEnabled: false;
    graduationEnabled: false;
    dammEnabled: false;
    dlmmEnabled: false;
  }>;
  gates: Readonly<{ broadcastAllowed: false; activationAllowed: false }>;
  planSha256: string;
}>;
type ReceiptRecord = Readonly<{
  kind: "deployment" | "configuration";
  name: string;
  actor: Address;
  nonce: number;
  transactionHash: Hex;
  blockNumber: string;
  contractAddress: Address | null;
  gasUsed: string;
  effectiveGasPriceWei: string;
  feeWei: string;
}>;

const APPROVED_PLAN = "ecf17b16b6badd0eeb54a7d308ada4a565223693e2c92fdf8b3df9d4863316fb";
const APPROVED_CAP = "0.0004";
const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/stock-quotes/deployment-plan.json");
const executionPath = path.join(root, "deployments/mainnet/stock-quotes/deployment-execution.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
const unsigned = { ...plan } as Record<string, unknown>;
delete unsigned.planSha256;
const calculatedPlan = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const requestedPlan = process.argv.find((value) => value.startsWith("--confirm-plan="))?.split("=")[1];
const requestedCap = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];

assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV_MAINNET_REQUIRED");
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.feature, "stock-quote-assets-damm-dlmm");
assert.equal(plan.deployments.length, 10);
assert.equal(plan.calls.length, 8);
assert.deepEqual(plan.releaseState, {
  quoteTradingEnabled: false,
  graduationEnabled: false,
  dammEnabled: false,
  dlmmEnabled: false,
});
assert.deepEqual(plan.gates, { broadcastAllowed: false, activationAllowed: false });
assert.equal(calculatedPlan, plan.planSha256, "PLAN_CONTENT_HASH_MISMATCH");
assert.equal(plan.planSha256, APPROVED_PLAN, "PLAN_NOT_APPROVED");
assert.equal(requestedPlan, APPROVED_PLAN, "EXPLICIT_PLAN_CONFIRMATION_REQUIRED");
assert.equal(requestedCap, APPROVED_CAP, "UNAPPROVED_FEE_CAP");

function accountFrom(name: string) {
  const value = process.env[name];
  assert(value && /^0x[0-9a-f]{64}$/iu.test(value), `${name}_INVALID`);
  const account = privateKeyToAccount(value as Hex);
  return account;
}
const deployer = accountFrom("DEPLOYER_PRIVATE_KEY");
assert.equal(deployer.address, getAddress(plan.deployer), "DEPLOYER_PRIVATE_KEY_ADDRESS_MISMATCH");
// Loaded here so prepareSafeOperation can validate both 2-of-2 Safe owners
// before any governed transaction is relayed.
accountFrom("GOVERNANCE_PRIVATE_KEY");
accountFrom("UPGRADER_PRIVATE_KEY");

const rpcFallbacks = (process.env.RPC_FALLBACK_URLS?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);
// Pin writes to one healthy endpoint. Sending a signed transaction through a
// ranked fallback can surface an unrelated endpoint's TLS/rate-limit failure.
const writeRpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || rpcFallbacks[1]
  || process.env.RPC_URL?.trim();
assert(writeRpcUrl, "STOCK_QUOTE_RPC_URL_REQUIRED");
const transport = http(writeRpcUrl, { timeout: 30_000, retryCount: 2 });
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [writeRpcUrl] } },
});
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: deployer, chain, transport });
assert.equal(await client.getChainId(), 4663, "RPC_CHAIN_MISMATCH");

let journal: { planSha256: string; receipts: ReceiptRecord[] } = {
  planSha256: plan.planSha256,
  receipts: [],
};
try {
  const loaded = JSON.parse(await readFile(executionPath, "utf8")) as typeof journal;
  assert.equal(loaded.planSha256, plan.planSha256, "EXECUTION_JOURNAL_PLAN_MISMATCH");
  journal = loaded;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const capWei = parseEther(APPROVED_CAP);
let spent = journal.receipts.reduce((total, receipt) => total + BigInt(receipt.feeWei), 0n);
assert(spent <= capWei, "RECORDED_FEE_EXCEEDS_CAP");
const save = async (status: string) => {
  await writeFile(executionPath, `${JSON.stringify({
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    feature: plan.feature,
    status,
    planSha256: plan.planSha256,
    approvedCapWei: capWei.toString(),
    approvedCapEth: APPROVED_CAP,
    totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent),
    releaseState: plan.releaseState,
    receipts: journal.receipts,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
};
const record = async (
  kind: ReceiptRecord["kind"],
  name: string,
  actor: Address,
  nonce: number,
  receipt: TransactionReceipt,
) => {
  assert.equal(receipt.status, "success", `${name}:REVERTED`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= capWei, `${name}:ACTUAL_FEE_CAP_EXCEEDED`);
  journal.receipts.push({
    kind,
    name,
    actor: getAddress(actor),
    nonce,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
  });
  await save("in-progress");
};
const recoverReceiptByNonce = async (actor: Address, nonce: number) => {
  if (actor.toLowerCase() === deployer.address.toLowerCase() && nonce === 677) {
    const recoveredHash = "0xc48f2870c8e3c92e714ca8b80573cf28761f79ce40e6ac4f028c4de0ccff6fba";
    const transaction = await client.getTransaction({ hash: recoveredHash });
    assert.equal(getAddress(transaction.from), deployer.address, "RECOVERED_UPGRADE_SENDER_MISMATCH");
    assert.equal(transaction.nonce, nonce, "RECOVERED_UPGRADE_NONCE_MISMATCH");
    return client.getTransactionReceipt({ hash: recoveredHash });
  }
  const latest = await client.getBlockNumber();
  const floor = latest > 5_000n ? latest - 5_000n : 0n;
  for (let blockNumber = latest; blockNumber >= floor; blockNumber -= 1n) {
    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    const transaction = block.transactions.find((candidate) =>
      typeof candidate !== "string"
      && candidate.from.toLowerCase() === actor.toLowerCase()
      && candidate.nonce === nonce
    );
    if (transaction && typeof transaction !== "string") {
      return client.getTransactionReceipt({ hash: transaction.hash });
    }
    if (blockNumber === 0n) break;
  }
  throw new Error(`TRANSACTION_RECEIPT_NOT_FOUND:${actor}:${nonce}`);
};
const prepareGas = async (request: { account: Address; to?: Address; data: Hex }, name: string) => {
  const [estimate, block] = await Promise.all([
    client.estimateGas(request),
    client.getBlock({ blockTag: "latest" }),
  ]);
  assert(block.baseFeePerGas !== null, `${name}:BASE_FEE_UNAVAILABLE`);
  const maxFeePerGas = (block.baseFeePerGas * 105n + 99n) / 100n;
  const gas = (estimate * 120n + 99n) / 100n;
  assert(spent + gas * maxFeePerGas <= capWei, `${name}:FEE_GUARD_STOPPED`);
  return { gas, maxFeePerGas };
};

for (const deployment of plan.deployments) {
  const prior = journal.receipts.find((entry) => entry.kind === "deployment" && entry.name === deployment.name);
  if (prior) {
    const code = await client.getCode({ address: getAddress(deployment.predictedContractAddress) });
    assert(code && code !== "0x", `${deployment.name}:RECORDED_CODE_MISSING`);
    continue;
  }
  const nonce = await client.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  assert.equal(nonce, deployment.nonce, `${deployment.name}:DEPLOYER_NONCE_DRIFT`);
  const { gas, maxFeePerGas } = await prepareGas({ account: deployer.address, data: deployment.data }, deployment.name);
  const hash = await wallet.sendTransaction({
    account: deployer,
    data: deployment.data,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  assert.equal(getAddress(receipt.contractAddress!), getAddress(deployment.predictedContractAddress), `${deployment.name}:ADDRESS_MISMATCH`);
  await record("deployment", deployment.name, deployer.address, nonce, receipt);
}

const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function hashOperationBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt) view returns (bytes32)",
  "function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)",
  "function executeBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt)",
]);
const upgrades = plan.calls.filter((call) => call.actor === "upgrader");
assert.equal(upgrades.length, 2, "UPGRADE_CALL_COUNT_MISMATCH");
const upgradeTargets = upgrades.map((call) => getAddress(call.target));
const upgradeValues = upgrades.map(() => 0n);
const upgradePayloads = upgrades.map((call) => call.data);
const upgradeSalt = keccak256(stringToHex(`ZKBLAST_STOCK_QUOTE_${plan.planSha256}`));
const operationId = await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "hashOperationBatch",
  args: [upgradeTargets, upgradeValues, upgradePayloads, zeroHash, upgradeSalt],
});
const relaySafeCall = async (name: string, target: Address, data: Hex) => {
  if (journal.receipts.some((entry) => entry.kind === "configuration" && entry.name === name)) return;
  const prepared = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.governance),
    to: getAddress(target),
    data,
    relayer: deployer,
  });
  const nonce = await client.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  const { gas, maxFeePerGas } = await prepareGas({ account: deployer.address, to: prepared.to, data: prepared.data }, name);
  const hash = await wallet.sendTransaction({
    account: deployer,
    to: prepared.to,
    data: prepared.data,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
  });
  await record(
    "configuration",
    name,
    deployer.address,
    nonce,
    await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 }),
  );
};

const minimumDelay = await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "getMinDelay",
});
assert.equal(minimumDelay, 300n, "UNEXPECTED_TIMELOCK_DELAY");
const scheduleData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "scheduleBatch",
  args: [upgradeTargets, upgradeValues, upgradePayloads, zeroHash, upgradeSalt, minimumDelay],
});
await relaySafeCall("Schedule stock quote Factory and Graduation Manager upgrades", getAddress(plan.upgrader), scheduleData);
let timestamp = await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "getTimestamp",
  args: [operationId],
});
const doneAfterSchedule = await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "isOperationDone",
  args: [operationId],
});
assert(timestamp > 1n || doneAfterSchedule, "UPGRADE_BATCH_NOT_SCHEDULED");
while (!doneAfterSchedule && (await client.getBlock()).timestamp < timestamp) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  timestamp = await client.readContract({
    address: getAddress(plan.upgrader),
    abi: timelockAbi,
    functionName: "getTimestamp",
    args: [operationId],
  });
}
const executeData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "executeBatch",
  args: [upgradeTargets, upgradeValues, upgradePayloads, zeroHash, upgradeSalt],
});
const executeLabel = "Execute stock quote Factory and Graduation Manager upgrades";
const operationAlreadyDone = await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "isOperationDone",
  args: [operationId],
});
if (
  operationAlreadyDone
  && !journal.receipts.some((entry) => entry.kind === "configuration" && entry.name === executeLabel)
) {
  const lastNonce = Math.max(...journal.receipts
    .filter((entry) => entry.actor.toLowerCase() === deployer.address.toLowerCase())
    .map((entry) => entry.nonce));
  const recoveredNonce = lastNonce + 1;
  await record(
    "configuration",
    executeLabel,
    deployer.address,
    recoveredNonce,
    await recoverReceiptByNonce(deployer.address, recoveredNonce),
  );
}
await relaySafeCall(executeLabel, getAddress(plan.upgrader), executeData);
assert.equal(await client.readContract({
  address: getAddress(plan.upgrader),
  abi: timelockAbi,
  functionName: "isOperationDone",
  args: [operationId],
}), true, "UPGRADE_BATCH_NOT_EXECUTED");

for (const call of plan.calls.filter((entry) => entry.actor === "governance")) {
  const prior = journal.receipts.find((entry) => entry.kind === "configuration" && entry.name === call.description);
  if (prior) continue;
  await relaySafeCall(call.description, getAddress(call.target), call.data);
}

assert.equal(journal.receipts.length, 18, "EXECUTION_RECEIPT_COUNT_MISMATCH");
await save("transactions-complete");
console.log(JSON.stringify({
  planSha256: plan.planSha256,
  transactions: journal.receipts.length,
  totalFeeWei: spent.toString(),
  totalFeeEth: formatEther(spent),
  approvedCapEth: APPROVED_CAP,
  executionPath,
}, null, 2));
