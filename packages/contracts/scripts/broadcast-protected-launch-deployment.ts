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
  deploymentTransactionCount: number;
  governanceTransactionCount: number;
  deployments: ReadonlyArray<{
    name: string;
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
    dataHash: Hex;
  }>;
  governanceCalls: ReadonlyArray<{
    description: string;
    target: Address;
    data: Hex;
    dataHash: Hex;
  }>;
  planSha256: string;
  gates: { broadcastAllowed: boolean };
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

const expectedHash = process.argv
  .find((item) => item.startsWith("--approved-plan-hash="))
  ?.slice("--approved-plan-hash=".length);
const capText = process.argv
  .find((item) => item.startsWith("--cap-eth="))
  ?.slice("--cap-eth=".length);
if (!expectedHash || !/^[a-f\d]{64}$/u.test(expectedHash) || !capText) {
  throw new Error("PROTECTED_LAUNCH_BROADCAST_APPROVAL_ARGUMENTS_REQUIRED");
}
const cap = parseEther(capText);
if (cap <= 0n) throw new Error("PROTECTED_LAUNCH_BROADCAST_CAP_INVALID");

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/protected-launch/deployment-plan.json",
);
const executionPath = path.join(
  root,
  "deployments/mainnet/protected-launch/deployment-execution.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
const { planSha256: storedHash, ...unsignedPlan } = plan;
const calculatedHash = createHash("sha256")
  .update(JSON.stringify(unsignedPlan))
  .digest("hex");
assert.equal(storedHash, calculatedHash, "Plan content hash mismatch");
assert.equal(storedHash, expectedHash, "Approved plan hash mismatch");
assert.equal(plan.chainId, 4663, "Protected Launch broadcast is Robinhood mainnet only");
assert.equal(plan.environment, "mainnet", "Mainnet plan required");
assert.equal(plan.gates.broadcastAllowed, false, "Plan must remain non-broadcastable by default");
assert.equal(plan.deployments.length, 16, "Unexpected deployment transaction count");
assert.equal(plan.governanceCalls.length, 8, "Unexpected governance operation count");

function requiredPrivateKey(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[\da-f]{64}$/iu.test(value)) throw new Error(`${name}_REQUIRED`);
  return value as Hex;
}
const deployer = privateKeyToAccount(requiredPrivateKey("DEPLOYER_PRIVATE_KEY"));
assert.equal(deployer.address, getAddress(plan.deployer), "Deployer key mismatch");
const signerAddresses = [
  privateKeyToAccount(requiredPrivateKey("GOVERNANCE_PRIVATE_KEY")).address,
  privateKeyToAccount(requiredPrivateKey("UPGRADER_PRIVATE_KEY")).address,
].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
assert.notEqual(signerAddresses[0], signerAddresses[1], "Safe signer keys must differ");

const primary = process.env.RPC_URL?.trim();
const fallbackUrls = (process.env.RPC_FALLBACK_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const urls = [...new Set([primary, ...fallbackUrls].filter((value): value is string => Boolean(value)))];
if (urls.length === 0) throw new Error("RPC_URL_REQUIRED");
const transport = fallback(
  urls.map((url) => http(url, { timeout: 30_000, retryCount: 1, retryDelay: 500 })),
  { rank: true, retryCount: 2, retryDelay: 500 },
);
// Transaction submission must be deterministic. A ranked fallback may select an
// endpoint that answers reads but rejects or intercepts eth_sendRawTransaction.
const broadcastUrl =
  process.env.RPC_BROADCAST_URL?.trim() || fallbackUrls[0] || primary;
if (!broadcastUrl) throw new Error("RPC_BROADCAST_URL_REQUIRED");
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({
  account: deployer,
  transport: http(broadcastUrl, {
    timeout: 30_000,
    // Retrying eth_sendRawTransaction can turn a successful first submission
    // into an `already known` error before its hash is persisted.
    retryCount: 0,
    retryDelay: 500,
  }),
});
assert.equal(await publicClient.getChainId(), 4663, "RPC chain mismatch");

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);
const [owners, threshold, safeNonce, pendingNonce, balance] = await Promise.all([
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "getOwners" }),
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "getThreshold" }),
  publicClient.readContract({ address: plan.governance, abi: safeAbi, functionName: "nonce" }),
  publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" }),
  publicClient.getBalance({ address: deployer.address }),
]);
assert.equal(threshold, 2n, "Governance Safe threshold drift");
assert(
  signerAddresses.every((signer) =>
    owners.some((owner) => getAddress(owner) === getAddress(signer)),
  ),
  "Configured keys are not both Governance Safe owners",
);
let receipts: ExecutionReceipt[] = [];
try {
  receipts = JSON.parse(await readFile(executionPath, "utf8")) as ExecutionReceipt[];
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") throw error;
}
const persist = async () => {
  await mkdir(path.dirname(executionPath), { recursive: true });
  await writeFile(executionPath, `${JSON.stringify(receipts, null, 2)}\n`, { mode: 0o600 });
};
let spent = receipts.reduce((total, receipt) => total + BigInt(receipt.totalFeeWei), 0n);
assert(spent <= cap, "Recorded fees already exceed approved cap");
assert(balance >= cap - spent, "Deployer balance is below remaining approved fee cap");
const feeGuard = async (estimatedGas: bigint, label: string) => {
  const gasPrice = await publicClient.getGasPrice();
  const buffered = (estimatedGas * gasPrice * 125n + 99n) / 100n;
  if (spent + buffered > cap) throw new Error(`FEE_CAP_GUARD:${label}`);
};
const record = async (
  stage: ExecutionReceipt["stage"],
  label: string,
  receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>,
) => {
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  if (spent > cap) throw new Error(`FEE_CAP_EXCEEDED_AFTER:${label}`);
  receipts.push({
    stage,
    label,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
  });
  await persist();
};
const submitTransaction = async (request: {
  data: Hex;
  gas: bigint;
  nonce: number;
  to?: Address;
}) => {
  const quotedGasPrice = await publicClient.getGasPrice();
  const maxFeePerGas = (quotedGasPrice * 125n + 99n) / 100n;
  const serializedTransaction = await deployer.signTransaction({
    chainId: 4663,
    type: "eip1559",
    data: request.data,
    gas: request.gas,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
    nonce: request.nonce,
    to: request.to,
    value: 0n,
  });
  const hash = keccak256(serializedTransaction);
  try {
    await walletClient.sendRawTransaction({ serializedTransaction });
  } catch (error) {
    // Public RPCs can accept the raw transaction but answer `already known`.
    // The locally derived hash remains authoritative and safe to await.
    if (!String(error).toLowerCase().includes("already known")) throw error;
  }
  return hash;
};

if (receipts.length === 0) {
  assert.equal(pendingNonce, plan.startingNonce, "Deployer nonce drift");
  const occupied = await Promise.all(
    plan.deployments.map((item) =>
      publicClient.getCode({ address: getAddress(item.predictedContractAddress) }),
    ),
  );
  assert(occupied.every((code) => !code || code === "0x"), "Predicted address already occupied");
} else {
  assert.equal(
    pendingNonce,
    plan.startingNonce + receipts.filter((item) => item.stage === "deployment").length +
      receipts.filter((item) => item.stage === "configuration").length,
    "Resume nonce drift",
  );
}

for (const item of plan.deployments) {
  const prior = receipts.find(
    (receipt) => receipt.stage === "deployment" && receipt.label === item.name,
  );
  if (prior) {
    const code = await publicClient.getCode({ address: item.predictedContractAddress });
    assert(code && code !== "0x", `Recorded deployment missing code: ${item.name}`);
    continue;
  }
  const nonce = await publicClient.getTransactionCount({
    address: deployer.address,
    blockTag: "pending",
  });
  assert.equal(nonce, item.nonce, `Nonce drift before ${item.name}`);
  assert.equal(keccak256(item.data), item.dataHash, `Deployment calldata drift: ${item.name}`);
  const estimatedGas = await publicClient.estimateGas({ account: deployer, data: item.data });
  await feeGuard(estimatedGas, item.name);
  const hash = await submitTransaction({
    data: item.data,
    nonce: item.nonce,
    gas: (estimatedGas * 120n + 99n) / 100n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `Deployment reverted: ${item.name}`);
  assert(
    receipt.contractAddress &&
      getAddress(receipt.contractAddress) === getAddress(item.predictedContractAddress),
    `Predicted address mismatch: ${item.name}`,
  );
  await record("deployment", item.name, receipt);
}

const configured = receipts.find(
  (receipt) => receipt.stage === "configuration" && receipt.label === "safe-multisend",
);
if (!configured) {
  for (const call of plan.governanceCalls) {
    assert.equal(keccak256(call.data), call.dataHash, `Governance calldata drift: ${call.description}`);
  }
  const multi = getMultiSendCallOnlyDeployment({ network: "4663" });
  const registered = multi?.networkAddresses["4663"];
  const expectedCodeHash = multi?.deployments.canonical?.codeHash;
  if (!multi || !registered || !expectedCodeHash) throw new Error("MULTISEND_UNAVAILABLE");
  const multiAddress = getAddress(registered);
  const multiCode = await publicClient.getCode({ address: multiAddress });
  assert(multiCode && keccak256(multiCode) === expectedCodeHash, "MultiSend code mismatch");
  const packed = concatHex(
    plan.governanceCalls.map((call) =>
      concatHex([
        numberToHex(0, { size: 1 }),
        call.target,
        numberToHex(0, { size: 32 }),
        numberToHex(size(call.data), { size: 32 }),
        call.data,
      ]),
    ),
  );
  const multiData = encodeFunctionData({
    abi: multi.abi,
    functionName: "multiSend",
    args: [packed],
  });
  const operation = await prepareSafeOperation(publicClient, {
    chainId: 4663,
    safe: getAddress(plan.governance),
    to: multiAddress,
    data: multiData,
    operation: 1,
    relayer: deployer,
  });
  assert.equal(operation.nonce, safeNonce, "Safe nonce drift");
  const deployerNonce = await publicClient.getTransactionCount({
    address: deployer.address,
    blockTag: "pending",
  });
  assert.equal(deployerNonce, plan.nextDeployerNonce, "Relayer nonce drift before Safe batch");
  const estimatedGas = await publicClient.estimateGas({
    account: deployer,
    to: operation.to,
    data: operation.data,
  });
  await feeGuard(estimatedGas, "safe-multisend");
  const hash = await submitTransaction({
    to: operation.to,
    data: operation.data,
    nonce: deployerNonce,
    gas: (estimatedGas * 120n + 99n) / 100n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", "Safe batch reverted");
  await record("configuration", "safe-multisend", receipt);
}

console.log(
  JSON.stringify(
    {
      planSha256: plan.planSha256,
      deploymentCount: receipts.filter((item) => item.stage === "deployment").length,
      configurationBatchCount: receipts.filter((item) => item.stage === "configuration").length,
      totalFeeWei: spent.toString(),
      totalFeeEth: formatEther(spent),
      approvedCapEth: formatEther(cap),
      executionPath,
    },
    null,
    2,
  ),
);
