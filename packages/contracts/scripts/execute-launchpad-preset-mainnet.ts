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
  type Abi,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type PlannedAction = Readonly<{
  name: string;
  target: Hex;
  data: Hex;
  safeNonce: string;
  relayerNonce: number;
  calldataHash: Hex;
}>;

type ReceiptRecord = Readonly<{
  name: string;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/launchpad-preset-v1-plan.json");
const executionPath = path.join(root, "deployments/mainnet/launchpad-preset-v1-execution.json");
const planBytes = await readFile(planPath);
const planHash = createHash("sha256").update(planBytes).digest("hex");
const plan = JSON.parse(planBytes.toString("utf8")) as {
  environment: string;
  chainId: number;
  governanceSafe: Hex;
  relayer: Hex;
  configManager: Hex;
  usdg: Hex;
  proposedPresetId: string;
  actions: PlannedAction[];
  broadcastAllowed: boolean;
};

assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert.equal(plan.environment, "mainnet", "Plan environment mismatch");
assert.equal(plan.chainId, 4663, "Plan chain mismatch");
assert.equal(plan.actions.length, 2, "Exactly two approved actions are required");
assert.deepEqual(plan.actions.map(({ name }) => name), [
  "allow-usdg-quote-token",
  "create-damm-usdg-preset-v1",
]);
assert.equal(plan.broadcastAllowed, false, "Planner authorization invariant changed");
const confirmedPlan = process.argv.find((value) => value.startsWith("--confirm-plan="))?.split("=")[1];
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(confirmedPlan, planHash, "Exact plan confirmation missing");
assert.equal(capArg, "0.00001", "Unapproved fee cap");
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
assert.equal(await publicClient.getChainId(), 4663, "RPC chain mismatch");
const relayer = privateKeyToAccount(privateKey as Hex);
assert.equal(relayer.address, getAddress(plan.relayer), "Relayer key mismatch");
const wallet = createWalletClient({ account: relayer, chain, transport });

let journal: { planSha256: string; receipts: ReceiptRecord[] } | undefined;
try {
  journal = JSON.parse(await readFile(executionPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (journal) assert.equal(journal.planSha256, planHash, "Execution journal belongs to another plan");
const receipts = [...(journal?.receipts ?? [])];
let spent = receipts.reduce((total, receipt) => total + BigInt(receipt.totalFeeWei), 0n);
assert(spent <= cap, "Recorded fee exceeds approved cap");

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

const record = async (name: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${name} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `Actual fee exceeded approved cap after ${name}`);
  receipts.push({
    name,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
  });
  await persist("in-progress");
};

for (const action of plan.actions) {
  if (receipts.some(({ name }) => name === action.name)) continue;
  assert.equal(
    await publicClient.getTransactionCount({ address: relayer.address, blockTag: "pending" }),
    action.relayerNonce,
    `Relayer nonce drift before ${action.name}`,
  );
  assert.equal(keccak256(action.data), action.calldataHash, `Calldata drift before ${action.name}`);
  const operation = await prepareSafeOperation(publicClient, {
    chainId: 4663,
    safe: getAddress(plan.governanceSafe),
    to: getAddress(action.target),
    data: action.data,
    relayer,
  });
  assert.equal(operation.nonce.toString(), action.safeNonce, `Safe nonce drift before ${action.name}`);
  const estimatedGas = await publicClient.estimateGas({ account: relayer, to: operation.to, data: operation.data });
  const gasPrice = await publicClient.getGasPrice();
  const guardedFee = estimatedGas * gasPrice * 150n / 100n;
  assert(spent + guardedFee <= cap, `Fee guard stopped before ${action.name}`);
  const hash = await wallet.sendTransaction({
    account: relayer,
    to: operation.to,
    data: operation.data,
    nonce: action.relayerNonce,
  });
  await record(action.name, await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }));
}

const configAbi = (JSON.parse(await readFile(
  path.join(root, "packages/contracts/out/LaunchpadConfigManager.sol/LaunchpadConfigManager.json"),
  "utf8",
)) as { abi: Abi }).abi;
const [quoteAllowed, presetCount, preset] = await Promise.all([
  publicClient.readContract({
    address: getAddress(plan.configManager), abi: configAbi, functionName: "quoteTokenAllowed", args: [getAddress(plan.usdg)],
  }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "presetCount" }),
  publicClient.readContract({
    address: getAddress(plan.configManager), abi: configAbi, functionName: "preset", args: [BigInt(plan.proposedPresetId)],
  }),
]);
assert.equal(quoteAllowed, true, "USDG quote token was not enabled");
assert.equal(presetCount, 1n, "Unexpected preset count");
assert.equal((preset as { enabled: boolean }).enabled, true, "Preset was not enabled");
await persist("verified");
console.log(JSON.stringify({
  planSha256: planHash,
  status: "verified",
  transactions: receipts.map(({ transactionHash }) => transactionHash),
  transactionCount: receipts.length,
  totalFeeWei: spent.toString(),
  totalFeeEth: formatEther(spent),
  capEth: formatEther(cap),
  quoteTokenAllowed: quoteAllowed,
  presetCount: presetCount.toString(),
  presetEnabled: (preset as { enabled: boolean }).enabled,
  executionPath,
}));
