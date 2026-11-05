import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMultiSendCallOnlyDeployment } from "@safe-global/safe-deployments";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  formatEther,
  getAddress,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  parseEther,
  size,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Plan = Readonly<{
  chainId: number;
  environment: string;
  deployer: Address;
  governance: Address;
  startingNonce: number;
  nextDeployerNonce: number;
  deployments: ReadonlyArray<{
    name: string;
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
  }>;
  governanceCalls: ReadonlyArray<{ description: string; target: Address; data: Hex }>;
  planSha256: string;
  activation: { registeredSources: number; enabledRoutes: number; pilotBudgetRaw: string; failClosed: boolean };
  gates: { broadcastAllowed: boolean; productionMigrationAllowed: boolean };
}>;
type ExecutionReceipt = Readonly<{
  stage: "deployment" | "configuration";
  label: string;
  transactionHash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  contractAddress: Address | null;
}>;

const approvedHash = process.argv.find((value) => value.startsWith("--approved-plan-hash="))?.split("=")[1];
const capText = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
if (!approvedHash || !/^[a-f\d]{64}$/u.test(approvedHash) || !capText) {
  throw new Error("ASSISTANCE_FUND_BROADCAST_APPROVAL_REQUIRED");
}
const feeCap = parseEther(capText);
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/mainnet/assistance-fund");
const plan = JSON.parse(await readFile(path.join(directory, "deployment-plan.json"), "utf8")) as Plan;
const { planSha256, ...unsignedPlan } = plan;
assert.equal(createHash("sha256").update(JSON.stringify(unsignedPlan)).digest("hex"), planSha256, "Plan hash drift");
assert.equal(planSha256, approvedHash, "Approved plan hash mismatch");
assert.equal(plan.chainId, 4663, "Robinhood mainnet only");
assert.equal(plan.environment, "mainnet", "Mainnet plan required");
assert.equal(plan.startingNonce, 639, "Approved starting nonce drift");
assert.equal(plan.deployments.length, 12, "Deployment count drift");
assert.equal(plan.governanceCalls.length, 8, "Governance call count drift");
assert.deepEqual(plan.activation, { registeredSources: 0, enabledRoutes: 0, pilotBudgetRaw: "0", failClosed: true });
assert.equal(plan.gates.broadcastAllowed, false);
assert.equal(plan.gates.productionMigrationAllowed, false);

function key(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[\da-f]{64}$/iu.test(value)) throw new Error(`${name}_REQUIRED`);
  return value as Hex;
}
const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
assert.equal(deployer.address, getAddress(plan.deployer), "Deployer key mismatch");
const ownerAddresses = [
  privateKeyToAccount(key("GOVERNANCE_PRIVATE_KEY")).address,
  privateKeyToAccount(key("UPGRADER_PRIVATE_KEY")).address,
];
assert.notEqual(ownerAddresses[0], ownerAddresses[1], "Safe keys must be distinct");

const primary = process.env.RPC_URL?.trim();
const fallbacks = (process.env.RPC_FALLBACK_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const urls = [...new Set([primary, ...fallbacks].filter((value): value is string => Boolean(value)))];
if (urls.length === 0) throw new Error("RPC_URL_REQUIRED");
const publicClient = createPublicClient({
  transport: fallback(urls.map((url) => http(url, { timeout: 30_000, retryCount: 1 })), { rank: true }),
});
const broadcastUrl = process.env.RPC_BROADCAST_URL?.trim() || fallbacks[0] || primary;
if (!broadcastUrl) throw new Error("RPC_BROADCAST_URL_REQUIRED");
const walletClient = createWalletClient({ account: deployer, transport: http(broadcastUrl, { timeout: 30_000, retryCount: 0 }) });
assert.equal(await publicClient.getChainId(), 4663, "RPC chain mismatch");

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);
const [safeOwners, threshold, safeNonce, balance] = await Promise.all([
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "getOwners" }),
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "getThreshold" }),
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "nonce" }),
  publicClient.getBalance({ address: deployer.address }),
]);
assert.equal(threshold, 2n, "Safe threshold drift");
assert(ownerAddresses.every((owner) => safeOwners.some((safeOwner) => getAddress(safeOwner) === owner)), "Safe owners mismatch");

const executionPath = path.join(directory, "deployment-execution.json");
let receipts: ExecutionReceipt[] = [];
try {
  receipts = JSON.parse(await readFile(executionPath, "utf8")) as ExecutionReceipt[];
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
let spent = receipts.reduce((sum, receipt) => sum + BigInt(receipt.totalFeeWei), 0n);
assert(spent <= feeCap && balance >= feeCap - spent, "Insufficient balance or fee cap already exceeded");
const persist = async () => {
  await mkdir(directory, { recursive: true });
  await writeFile(executionPath, `${JSON.stringify(receipts, null, 2)}\n`, { mode: 0o600 });
};
const guard = async (gas: bigint, label: string) => {
  const buffered = gas * (await publicClient.getGasPrice()) * 130n / 100n;
  if (spent + buffered > feeCap) throw new Error(`FEE_CAP_GUARD:${label}`);
};
const record = async (stage: ExecutionReceipt["stage"], label: string, receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>) => {
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  if (spent > feeCap) throw new Error(`FEE_CAP_EXCEEDED:${label}`);
  receipts.push({ stage, label, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), totalFeeWei: fee.toString(), contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null });
  await persist();
};
const submit = async (request: { data: Hex; gas: bigint; nonce: number; to?: Address }) => {
  const maxFeePerGas = await publicClient.getGasPrice() * 125n / 100n;
  const serialized = await deployer.signTransaction({ chainId: 4663, type: "eip1559", data: request.data, gas: request.gas, maxFeePerGas, maxPriorityFeePerGas: 0n, nonce: request.nonce, to: request.to, value: 0n });
  const hash = keccak256(serialized);
  try {
    await walletClient.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    if (!String(error).toLowerCase().includes("already known")) throw error;
  }
  return hash;
};

const pendingNonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
const deployedCount = receipts.filter((receipt) => receipt.stage === "deployment").length;
const configuredCount = receipts.filter((receipt) => receipt.stage === "configuration").length;
assert.equal(pendingNonce, plan.startingNonce + deployedCount + configuredCount, "Resume nonce drift");

for (const item of plan.deployments) {
  if (receipts.some((receipt) => receipt.stage === "deployment" && receipt.label === item.name)) continue;
  const nonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  assert.equal(nonce, item.nonce, `Nonce drift before ${item.name}`);
  const existingCode = await publicClient.getCode({ address: item.predictedContractAddress });
  assert(!existingCode || existingCode === "0x", `Address occupied: ${item.name}`);
  const estimate = await publicClient.estimateGas({ account: deployer, data: item.data });
  await guard(estimate, item.name);
  const hash = await submit({ data: item.data, gas: estimate * 120n / 100n, nonce });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `Deployment reverted: ${item.name}`);
  assert.equal(getAddress(receipt.contractAddress!), getAddress(item.predictedContractAddress), `Address mismatch: ${item.name}`);
  await record("deployment", item.name, receipt);
}

if (!receipts.some((receipt) => receipt.stage === "configuration")) {
  const multi = getMultiSendCallOnlyDeployment({ network: "4663" });
  const registered = multi?.networkAddresses["4663"];
  const codeHash = multi?.deployments.canonical?.codeHash;
  if (!multi || !registered || !codeHash) throw new Error("MULTISEND_UNAVAILABLE");
  const multiAddress = getAddress(registered);
  assert.equal(keccak256((await publicClient.getCode({ address: multiAddress }))!), codeHash, "MultiSend code mismatch");
  const packed = concatHex(plan.governanceCalls.map((call) => concatHex([numberToHex(0, { size: 1 }), call.target, numberToHex(0, { size: 32 }), numberToHex(size(call.data), { size: 32 }), call.data])));
  const operation = await prepareSafeOperation(publicClient, { chainId: 4663, safe: plan.governance, to: multiAddress, data: encodeFunctionData({ abi: multi.abi, functionName: "multiSend", args: [packed] }), operation: 1, relayer: deployer });
  assert.equal(operation.nonce, safeNonce, "Safe nonce drift");
  const nonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  assert.equal(nonce, plan.nextDeployerNonce, "Relayer nonce drift");
  const estimate = await publicClient.estimateGas({ account: deployer, to: operation.to, data: operation.data });
  await guard(estimate, "safe-multisend");
  const hash = await submit({ to: operation.to, data: operation.data, gas: estimate * 120n / 100n, nonce });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", "Safe configuration reverted");
  await record("configuration", "safe-multisend", receipt);
}

console.log(JSON.stringify({ planSha256, deployments: receipts.filter((receipt) => receipt.stage === "deployment").length, configurationBatches: receipts.filter((receipt) => receipt.stage === "configuration").length, totalFeeWei: spent.toString(), totalFeeEth: formatEther(spent), approvedCapEth: formatEther(feeCap), executionPath }, null, 2));
