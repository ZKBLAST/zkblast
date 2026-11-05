import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Plan = Readonly<{
  schemaVersion: 1;
  feature: "stock-quote-policy-receipts";
  environment: "mainnet";
  chainId: 4663;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  startingNonce: number;
  nextDeployerNonce: number;
  deployments: readonly Readonly<{ name: string; nonce: number; predictedContractAddress: Address; data: Hex }>[];
  calls: readonly Readonly<{ actor: "governance" | "upgrader"; description: string; target: Address; data: Hex }>[];
  releaseState: Readonly<{ quoteTradingEnabled: false; graduationEnabled: false }>;
  gates: Readonly<{ broadcastAllowed: false; activationAllowed: false }>;
  planSha256: string;
}>;
type Journal = {
  planSha256: string;
  receipts: Array<{
    stage: "deployment" | "configuration";
    label: string;
    transactionHash: Hex;
    blockNumber: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    feeWei: string;
    contractAddress: Address | null;
  }>;
};

const approvedHash = process.argv.find((value) => value.startsWith("--approved-plan-hash="))?.split("=")[1];
const capText = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert(approvedHash && /^[a-f\d]{64}$/u.test(approvedHash), "APPROVED_PLAN_HASH_REQUIRED");
assert(capText, "APPROVED_FEE_CAP_REQUIRED");
const capWei = parseEther(capText);
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/mainnet/stock-quotes");
const plan = JSON.parse(await readFile(path.join(directory, "policy-receipts-upgrade-plan.json"), "utf8")) as Plan;
const simulation = JSON.parse(await readFile(path.join(directory, "policy-receipts-upgrade-simulation.json"), "utf8")) as {
  planSha256: string;
  transactions: number;
  assertions: Record<string, boolean>;
};
const unsigned = { ...plan } as Record<string, unknown>;
delete unsigned.planSha256;
assert.equal(createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"), plan.planSha256, "PLAN_HASH_DRIFT");
assert.equal(plan.planSha256, approvedHash, "PLAN_NOT_APPROVED");
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.deployments.length, 4);
assert.equal(plan.calls.length, 5);
assert.deepEqual(plan.releaseState, { quoteTradingEnabled: false, graduationEnabled: false });
assert.deepEqual(plan.gates, { broadcastAllowed: false, activationAllowed: false });
assert.equal(simulation.planSha256, plan.planSha256, "SIMULATION_PLAN_MISMATCH");
assert.equal(simulation.transactions, 9, "SIMULATION_TRANSACTION_COUNT_MISMATCH");
assert.equal(simulation.assertions.poolDeployerInstalled, true);
assert.equal(simulation.assertions.poolDeployerFactoryBound, true);
assert.equal(simulation.assertions.policyIdentityAvailable, true);
assert.equal(simulation.assertions.quoteTradingEnabled, false);
assert.equal(simulation.assertions.graduationEnabled, false);

function requiredKey(name: string): Hex {
  const value = process.env[name]?.trim();
  assert(value && /^0x[\da-f]{64}$/iu.test(value), `${name}_INVALID`);
  return value as Hex;
}
const deployer = privateKeyToAccount(requiredKey("DEPLOYER_PRIVATE_KEY"));
assert.equal(deployer.address, getAddress(plan.deployer), "DEPLOYER_KEY_MISMATCH");
requiredKey("GOVERNANCE_PRIVATE_KEY");
requiredKey("UPGRADER_PRIVATE_KEY");

const configuredFallbacks = (process.env.RPC_FALLBACK_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const candidates = [...new Set([process.env.RPC_URL?.trim(), ...configuredFallbacks, "https://robinhood.drpc.org"].filter((value): value is string => Boolean(value)))];
let rpcUrl: string | undefined;
for (const candidate of candidates) {
  try {
    const probe = createPublicClient({ transport: http(candidate, { timeout: 12_000, retryCount: 0 }) });
    if (await probe.getChainId() === plan.chainId) { rpcUrl = candidate; break; }
  } catch { /* probe the next configured/public endpoint */ }
}
assert(rpcUrl, "NO_HEALTHY_MAINNET_RPC");
const publicClient = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }) });
const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }) });

const journalPath = path.join(directory, "policy-receipts-upgrade-execution.private.json");
let journal: Journal = { planSha256: plan.planSha256, receipts: [] };
try {
  journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  assert.equal(journal.planSha256, plan.planSha256, "JOURNAL_PLAN_MISMATCH");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
let spent = journal.receipts.reduce((sum, receipt) => sum + BigInt(receipt.feeWei), 0n);
const persist = () => writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
const record = async (stage: "deployment" | "configuration", label: string, receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>) => {
  assert.equal(receipt.status, "success", `${label}:REVERTED`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= capWei, `${label}:FEE_CAP_EXCEEDED`);
  journal.receipts.push({
    stage,
    label,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
  });
  await persist();
};
const gasTerms = async (request: { account: Address; data: Hex; to?: Address }, label: string) => {
  const [estimate, gasPrice] = await Promise.all([publicClient.estimateGas(request), publicClient.getGasPrice()]);
  const gas = (estimate * 120n + 99n) / 100n;
  const maxFeePerGas = (gasPrice * 125n + 99n) / 100n;
  assert(spent + gas * maxFeePerGas <= capWei, `${label}:FEE_CAP_GUARD`);
  return { gas, maxFeePerGas };
};
const send = async (label: string, stage: "deployment" | "configuration", data: Hex, to?: Address) => {
  const nonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  const estimationRequest = to
    ? { account: deployer.address, data, to }
    : { account: deployer.address, data };
  const { gas, maxFeePerGas } = await gasTerms(estimationRequest, label);
  let hash: Hex;
  try {
    hash = await walletClient.sendTransaction({ account: deployer, chain: null, data, to, nonce, gas, maxFeePerGas, maxPriorityFeePerGas: 0n, value: 0n });
  } catch (error) {
    const message = String(error).toLowerCase();
    if (!message.includes("nonce") || !message.includes("lower")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    hash = await findRecentTransactionByNonce(nonce);
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  await record(stage, label, receipt);
  return receipt;
};

const findRecentTransactionByNonce = async (nonce: number) => {
  const latest = await publicClient.getBlockNumber();
  for (let offset = 0n; offset < 5_000n; offset += 25n) {
    const numbers = Array.from({ length: 25 }, (_, index) => latest - offset - BigInt(index))
      .filter((blockNumber) => blockNumber >= 0n);
    const blocks = await Promise.all(numbers.map((blockNumber) =>
      publicClient.getBlock({ blockNumber, includeTransactions: true })
    ));
    for (const block of blocks) {
      const transaction = block.transactions.find((candidate) =>
        typeof candidate !== "string"
        && candidate.from.toLowerCase() === deployer.address.toLowerCase()
        && candidate.nonce === nonce
      );
      if (transaction && typeof transaction !== "string") return transaction.hash;
    }
  }
  throw new Error(`RECENT_TRANSACTION_NOT_FOUND:${nonce}`);
};

// A write RPC may accept a signed transaction and still return a stale nonce
// error. Reconcile deterministic deployment addresses before retrying so the
// same approved nonce is never submitted blindly.
for (const deployment of plan.deployments) {
  if (journal.receipts.some((receipt) => receipt.stage === "deployment" && receipt.label === deployment.name)) continue;
  const code = await publicClient.getCode({ address: deployment.predictedContractAddress });
  if (!code || code === "0x") break;
  const hash = await findRecentTransactionByNonce(deployment.nonce);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  assert.equal(getAddress(receipt.contractAddress!), getAddress(deployment.predictedContractAddress), `${deployment.name}:RECOVERED_ADDRESS_MISMATCH`);
  await record("deployment", deployment.name, receipt);
}

const completedDeployments = journal.receipts.filter((receipt) => receipt.stage === "deployment").length;
const completedConfigurations = journal.receipts.filter((receipt) => receipt.stage === "configuration").length;
const [pendingNonce, balance] = await Promise.all([
  publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" }),
  publicClient.getBalance({ address: deployer.address }),
]);
assert.equal(pendingNonce, plan.startingNonce + completedDeployments + completedConfigurations, "DEPLOYER_NONCE_DRIFT");
assert(balance >= capWei - spent, "INSUFFICIENT_DEPLOYER_BALANCE_FOR_CAP");

for (const deployment of plan.deployments) {
  if (journal.receipts.some((receipt) => receipt.stage === "deployment" && receipt.label === deployment.name)) continue;
  assert.equal(await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" }), deployment.nonce, `${deployment.name}:NONCE_DRIFT`);
  const existingCode = await publicClient.getCode({ address: deployment.predictedContractAddress });
  assert(!existingCode || existingCode === "0x", `${deployment.name}:ADDRESS_OCCUPIED`);
  const receipt = await send(deployment.name, "deployment", deployment.data);
  assert.equal(getAddress(receipt.contractAddress!), getAddress(deployment.predictedContractAddress), `${deployment.name}:ADDRESS_MISMATCH`);
}

const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hashOperationBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt) view returns (bytes32)",
  "function getTimestamp(bytes32 id) view returns (uint256)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)",
  "function executeBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt)",
]);
const upgrades = plan.calls.filter((call) => call.actor === "upgrader");
assert.equal(upgrades.length, 3, "UPGRADE_COUNT_DRIFT");
const targets = upgrades.map((call) => getAddress(call.target));
const values = upgrades.map(() => 0n);
const payloads = upgrades.map((call) => call.data);
const salt = keccak256(stringToHex(`ZKBLAST_STOCK_QUOTE_POLICY_RECEIPTS_${plan.planSha256}`));
const operationId = await publicClient.readContract({ address: plan.upgrader, abi: timelockAbi, functionName: "hashOperationBatch", args: [targets, values, payloads, zeroHash, salt] });
const delay = await publicClient.readContract({ address: plan.upgrader, abi: timelockAbi, functionName: "getMinDelay" });
assert.equal(delay, 300n, "TIMELOCK_DELAY_DRIFT");
const relaySafe = async (label: string, target: Address, data: Hex) => {
  if (journal.receipts.some((receipt) => receipt.stage === "configuration" && receipt.label === label)) return;
  const prepared = await prepareSafeOperation(publicClient, { chainId: plan.chainId, safe: plan.governance, to: target, data, relayer: deployer });
  await send(label, "configuration", prepared.data, prepared.to);
};
await relaySafe("schedule-policy-receipt-upgrades", plan.upgrader, encodeFunctionData({ abi: timelockAbi, functionName: "scheduleBatch", args: [targets, values, payloads, zeroHash, salt, delay] }));
while (!(await publicClient.readContract({ address: plan.upgrader, abi: timelockAbi, functionName: "isOperationDone", args: [operationId] }))) {
  const timestamp = await publicClient.readContract({ address: plan.upgrader, abi: timelockAbi, functionName: "getTimestamp", args: [operationId] });
  if ((await publicClient.getBlock()).timestamp >= timestamp) break;
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await relaySafe("execute-policy-receipt-upgrades", plan.upgrader, encodeFunctionData({ abi: timelockAbi, functionName: "executeBatch", args: [targets, values, payloads, zeroHash, salt] }));
assert.equal(await publicClient.readContract({ address: plan.upgrader, abi: timelockAbi, functionName: "isOperationDone", args: [operationId] }), true, "TIMELOCK_OPERATION_NOT_DONE");
for (const call of plan.calls.filter((item) => item.actor === "governance")) {
  await relaySafe(call.description, call.target, call.data);
}

assert.equal(journal.receipts.length, 8, "FINAL_RECEIPT_COUNT_MISMATCH");
console.log(JSON.stringify({
  planSha256: plan.planSha256,
  transactions: journal.receipts.length,
  totalFeeWei: spent.toString(),
  totalFeeEth: formatEther(spent),
  approvedCapEth: formatEther(capWei),
  quoteTradingEnabled: false,
  graduationEnabled: false,
  journalPath,
}, null, 2));
