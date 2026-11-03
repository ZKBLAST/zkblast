import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const planPath = path.join(directory, "launchpad-ui-funding-plan.json");
const planBytes = await readFile(planPath);
const planSha256 = createHash("sha256").update(planBytes).digest("hex");
const plan = JSON.parse(planBytes.toString("utf8")) as {
  chainId: number;
  owner: `0x${string}`;
  target: `0x${string}`;
  nonce: number;
  valueWei: string;
  valueHype: string;
  data: Hex;
  guardedGas: string;
};
const approvedPlan = process.argv
  .find((value) => value.startsWith("--approve-plan="))
  ?.split("=")[1];
const capArg = process.argv
  .find((value) => value.startsWith("--cap-hype="))
  ?.split("=")[1];
assert(process.argv.includes("--broadcast"), "HYPEREVM_UI_FUNDING_BROADCAST_FLAG_REQUIRED");
assert.equal(approvedPlan, planSha256, "HYPEREVM_UI_FUNDING_PLAN_MISMATCH");
assert.equal(capArg, "0.00001", "HYPEREVM_UI_FUNDING_GAS_CAP_INVALID");
assert.equal(plan.chainId, 999);
assert.equal(plan.nonce, 59);
assert.equal(plan.valueHype, "0.001");

const signerKeys = [
  process.env.GOVERNANCE_PRIVATE_KEY,
  process.env.DEPLOYER_PRIVATE_KEY,
].filter((value): value is string => Boolean(value && /^0x[0-9a-f]{64}$/iu.test(value)));
const account = signerKeys
  .map((privateKey) => privateKeyToAccount(privateKey as Hex))
  .find((candidate) => getAddress(candidate.address) === getAddress(plan.owner));
assert(account, "HYPEREVM_UI_FUNDING_SIGNER_MISSING");
const transport = http(
  process.env.HYPEREVM_MAINNET_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm",
  { timeout: 20_000, retryCount: 1 },
);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
assert.equal(await publicClient.getChainId(), 999);
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const [nonce, before, balance, gasPrice] = await Promise.all([
  publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  publicClient.readContract({
    address: getAddress(plan.target),
    abi,
    functionName: "balanceOf",
    args: [account.address],
  }),
  publicClient.getBalance({ address: account.address }),
  publicClient.getGasPrice(),
]);
assert.equal(nonce, plan.nonce, "HYPEREVM_UI_FUNDING_NONCE_DRIFT");
assert.equal(before, 0n, "HYPEREVM_UI_FUNDING_BALANCE_DRIFT");
const value = BigInt(plan.valueWei);
const gas = BigInt(plan.guardedGas);
const cap = parseEther(capArg);
assert(gas * gasPrice <= cap, "HYPEREVM_UI_FUNDING_FEE_CAP_EXCEEDED");
assert(balance > value + cap, "HYPEREVM_UI_FUNDING_NATIVE_BALANCE_LOW");
const transactionHash = await walletClient.sendTransaction({
  account,
  chain: null,
  to: getAddress(plan.target),
  data: plan.data,
  value,
  nonce,
  gas,
  gasPrice,
});
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
  confirmations: 1,
  timeout: 120_000,
});
assert.equal(receipt.status, "success", "HYPEREVM_UI_FUNDING_REVERTED");
const totalFeeWei = receipt.gasUsed * receipt.effectiveGasPrice;
assert(totalFeeWei <= cap, "HYPEREVM_UI_FUNDING_ACTUAL_FEE_EXCEEDED");
const after = await publicClient.readContract({
  address: getAddress(plan.target),
  abi,
  functionName: "balanceOf",
  args: [account.address],
});
assert.equal(after, value, "HYPEREVM_UI_FUNDING_OUTPUT_MISMATCH");
const journal = {
  schemaVersion: 1,
  chainId: 999,
  planSha256,
  status: "verified",
  transactionHash,
  blockNumber: receipt.blockNumber.toString(),
  gasUsed: receipt.gasUsed.toString(),
  effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
  totalFeeWei: totalFeeWei.toString(),
  totalFeeHype: formatEther(totalFeeWei),
  wrappedHype: formatEther(after),
};
await writeFile(
  path.join(directory, "launchpad-ui-funding-execution.private.json"),
  `${JSON.stringify(journal, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(JSON.stringify(journal, null, 2));
