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
  keccak256,
  parseEther,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Deployment = Readonly<{
  name: string;
  nonce: number;
  predictedContractAddress: Address;
  calldata: Hex;
  calldataHash: Hex;
}>;
type Configuration = Readonly<{
  safeNonce: string;
  relayerNonce: number;
  target: Address;
  description: string;
  calldata: Hex;
  calldataHash: Hex;
}>;
type ReceiptRecord = Readonly<{
  stage: "deployment" | "configuration";
  label: string;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  contractAddress: Address | null;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/launchpad-v1-plan.json");
const executionPath = path.join(root, "deployments/mainnet/launchpad-v1-execution.json");
const planBytes = await readFile(planPath);
const planHash = createHash("sha256").update(planBytes).digest("hex");
const plan = JSON.parse(planBytes.toString("utf8")) as {
  environment: string;
  chainId: number;
  deployer: Address;
  startingNonce: number;
  deploymentTransactions: Deployment[];
  governedTransactions: Configuration[];
  governance: { admin: Address; safeNonce: string };
  authorization: { broadcastAllowed: boolean };
};

assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert.equal(plan.environment, "mainnet", "Plan environment mismatch");
assert.equal(plan.chainId, 4663, "Plan chain mismatch");
assert.equal(plan.deploymentTransactions.length, 15, "Deployment count mismatch");
assert.equal(plan.governedTransactions.length, 6, "Configuration count mismatch");
assert.equal(plan.authorization.broadcastAllowed, false, "Planner authorization invariant changed");
const confirm = process.argv.find((value) => value.startsWith("--confirm-plan="))?.split("=")[1];
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(confirm, planHash, "Exact plan confirmation missing");
assert.equal(capArg, "0.0004", "Unapproved fee cap");
assert(process.env.RPC_URL, "RPC_URL is required");
const cap = parseEther(capArg);
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
assert(privateKey && /^0x[0-9a-f]{64}$/iu.test(privateKey), "DEPLOYER_PRIVATE_KEY is invalid");

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
const deployer = privateKeyToAccount(privateKey as Hex);
assert.equal(deployer.address, getAddress(plan.deployer), "Deployer key mismatch");
const wallet = createWalletClient({ account: deployer, chain, transport });
assert.equal(await publicClient.getChainId(), 4663, "RPC chain mismatch");

let existing: { planSha256: string; receipts: ReceiptRecord[] } | undefined;
try {
  existing = JSON.parse(await readFile(executionPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (existing) assert.equal(existing.planSha256, planHash, "Execution journal belongs to another plan");
const receipts: ReceiptRecord[] = [...(existing?.receipts ?? [])];
let spent = receipts.reduce((sum, item) => sum + BigInt(item.totalFeeWei), 0n);
assert(spent <= cap, "Recorded fee already exceeds approved cap");

const persist = async (status: string) => {
  await writeFile(executionPath, `${JSON.stringify({
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    planSha256: planHash,
    capWei: cap.toString(),
    status,
    receipts,
    totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
};
const record = async (stage: ReceiptRecord["stage"], label: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${label} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `Actual fee exceeded approved cap after ${label}`);
  receipts.push({
    stage,
    label,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
  });
  await persist("in-progress");
};
const feeGuard = async (estimatedGas: bigint, label: string) => {
  const gasPrice = await publicClient.getGasPrice();
  const buffered = (estimatedGas * gasPrice * 120n + 99n) / 100n;
  assert(spent + buffered <= cap, `Fee guard stopped before ${label}`);
};

for (const transaction of plan.deploymentTransactions) {
  const prior = receipts.find((item) => item.stage === "deployment" && item.label === transaction.name);
  if (prior) {
    const code = await publicClient.getCode({ address: getAddress(transaction.predictedContractAddress) });
    assert(code && code !== "0x", `Recorded deployment missing code: ${transaction.name}`);
    continue;
  }
  assert.equal(await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" }), transaction.nonce, `Nonce drift before ${transaction.name}`);
  assert.equal(keccak256(transaction.calldata), transaction.calldataHash, `Calldata drift: ${transaction.name}`);
  const estimatedGas = await publicClient.estimateGas({ account: deployer, data: transaction.calldata });
  await feeGuard(estimatedGas, transaction.name);
  const hash = await wallet.sendTransaction({ account: deployer, data: transaction.calldata, nonce: transaction.nonce });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert(receipt.contractAddress && getAddress(receipt.contractAddress) === getAddress(transaction.predictedContractAddress), `Unexpected address: ${transaction.name}`);
  await record("deployment", transaction.name, receipt);
}

for (const transaction of plan.governedTransactions) {
  const prior = receipts.find((item) => item.stage === "configuration" && item.label === transaction.description);
  if (prior) continue;
  assert.equal(await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" }), transaction.relayerNonce, `Relayer nonce drift before ${transaction.description}`);
  assert.equal(keccak256(transaction.calldata), transaction.calldataHash, `Governed calldata drift: ${transaction.description}`);
  const operation = await prepareSafeOperation(publicClient, {
    chainId: 4663,
    safe: getAddress(plan.governance.admin),
    to: getAddress(transaction.target),
    data: transaction.calldata,
    relayer: deployer,
  });
  assert.equal(operation.nonce.toString(), transaction.safeNonce, `Safe nonce drift before ${transaction.description}`);
  const estimatedGas = await publicClient.estimateGas({ account: deployer, to: operation.to, data: operation.data });
  await feeGuard(estimatedGas, transaction.description);
  const hash = await wallet.sendTransaction({ account: deployer, to: operation.to, data: operation.data, nonce: transaction.relayerNonce });
  await record("configuration", transaction.description, await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
}

await persist("transactions-complete");
console.log(JSON.stringify({
  planSha256: planHash,
  transactionCount: receipts.length,
  deploymentCount: receipts.filter((item) => item.stage === "deployment").length,
  configurationCount: receipts.filter((item) => item.stage === "configuration").length,
  totalFeeWei: spent.toString(),
  totalFeeEth: formatEther(spent),
  capEth: formatEther(cap),
  executionPath,
}));
