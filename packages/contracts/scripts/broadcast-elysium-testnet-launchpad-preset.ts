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
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Action = Readonly<{
  name: string;
  target: Address;
  nonce: number;
  data: Hex;
  guardedGas: string;
}>;
type ReceiptRecord = Readonly<{
  name: string;
  transactionHash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const planPath = path.join(directory, "launchpad-preset-v1-plan.json");
const journalPath = path.join(directory, "launchpad-preset-v1-execution.private.json");
const planBytes = await readFile(planPath);
const planSha256 = createHash("sha256").update(planBytes).digest("hex");
const plan = JSON.parse(planBytes.toString("utf8")) as {
  chainId: number;
  governance: Address;
  configManager: Address;
  quoteToken: Address;
  proposedPresetId: string;
  startingNonce: number;
  nextNonce: number;
  actions: Action[];
  safety: { broadcastAllowed: boolean; explicitApprovalRequired: boolean };
};
const approvedPlan = process.argv.find((value) => value.startsWith("--approve-plan="))?.split("=")[1];
const capArg = process.argv.find((value) => value.startsWith("--cap-hype="))?.split("=")[1];
assert(process.argv.includes("--broadcast"), "ELYSIUM_PRESET_BROADCAST_FLAG_REQUIRED");
assert.equal(approvedPlan, planSha256, "ELYSIUM_PRESET_PLAN_APPROVAL_MISMATCH");
assert.equal(capArg, "0.00005", "ELYSIUM_PRESET_FEE_CAP_INVALID");
assert.equal(plan.chainId, 99_801);
assert.equal(plan.startingNonce, 63);
assert.equal(plan.nextNonce, 65);
assert.equal(plan.actions.length, 2);
assert.deepEqual(plan.actions.map(({ name, nonce }) => ({ name, nonce })), [
  { name: "allow-whype-quote-token", nonce: 63 },
  { name: "create-whype-pending-graduation-preset-v1", nonce: 64 },
]);
assert.equal(plan.safety.broadcastAllowed, false);
assert.equal(plan.safety.explicitApprovalRequired, true);

const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(privateKey && /^0x[0-9a-f]{64}$/iu.test(privateKey), "ELYSIUM_PRESET_SIGNER_REQUIRED");
const account = privateKeyToAccount(privateKey as Hex);
assert.equal(getAddress(account.address), getAddress(plan.governance), "ELYSIUM_PRESET_SIGNER_MISMATCH");
const transport = http(
  process.env.ELYSIUM_PRIVATE_RPC_URL?.trim() || "https://testnet-rpc.elysium.kinetiq.xyz",
  { retryCount: 5, retryDelay: 750, timeout: 30_000 },
);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
assert.equal(await publicClient.getChainId(), plan.chainId, "ELYSIUM_PRESET_CHAIN_MISMATCH");
const configAbi = (JSON.parse(await readFile(
  path.join(root, "packages/contracts/out/LaunchpadConfigManager.sol/LaunchpadConfigManager.json"),
  "utf8",
)) as { abi: Abi }).abi;
const [nonce, balance, presetCount, quoteAllowed] = await Promise.all([
  publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "presetCount" }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "quoteTokenAllowed", args: [getAddress(plan.quoteToken)] }),
]);
const priorJournal = await readFile(journalPath, "utf8")
  .then((value) => JSON.parse(value) as { planSha256: string; receipts: ReceiptRecord[]; totalFeeWei: string })
  .catch(() => null);
if (priorJournal) assert.equal(priorJournal.planSha256, planSha256, "ELYSIUM_PRESET_JOURNAL_MISMATCH");
const priorReceipts = priorJournal?.receipts ?? [];
assert.equal(nonce, plan.startingNonce + priorReceipts.length, "ELYSIUM_PRESET_NONCE_DRIFT");
assert.equal(presetCount, 0n, "ELYSIUM_PRESET_STATE_DRIFT");
assert.equal(quoteAllowed, priorReceipts.length > 0, "ELYSIUM_PRESET_QUOTE_STATE_DRIFT");
const cap = parseEther(capArg);
assert(balance >= cap, "ELYSIUM_PRESET_BALANCE_BELOW_CAP");

const receipts: ReceiptRecord[] = [...priorReceipts];
let totalFeeWei = BigInt(priorJournal?.totalFeeWei ?? "0");
const persist = async (status: string) =>
  writeFile(journalPath, `${JSON.stringify({
    schemaVersion: 1,
    chainId: plan.chainId,
    planSha256,
    capWei: cap.toString(),
    status,
    receipts,
    totalFeeWei: totalFeeWei.toString(),
    totalFeeHype: formatEther(totalFeeWei),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
const record = async (name: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${name}:REVERTED`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  totalFeeWei += fee;
  assert(totalFeeWei <= cap, `${name}:FEE_CAP_EXCEEDED`);
  receipts.push({
    name,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
  });
  await persist("in-progress");
};

await persist("prepared");
for (const action of plan.actions.slice(receipts.length)) {
  assert.equal(
    await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    action.nonce,
    `${action.name}:NONCE_DRIFT`,
  );
  const gasPrice = (await publicClient.getGasPrice() * 120n) / 100n;
  const gas = BigInt(action.guardedGas);
  assert(totalFeeWei + gas * gasPrice <= cap, `${action.name}:FEE_GUARD_STOPPED`);
  const transactionHash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: getAddress(action.target),
    data: action.data,
    nonce: action.nonce,
    gas,
    gasPrice,
  });
  await record(action.name, await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
    timeout: 120_000,
  }));
}
const [finalPresetCount, finalQuoteAllowed, preset] = await Promise.all([
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "presetCount" }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "quoteTokenAllowed", args: [getAddress(plan.quoteToken)] }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "preset", args: [BigInt(plan.proposedPresetId)] }),
]);
assert.equal(finalPresetCount, 1n, "ELYSIUM_PRESET_COUNT_INVALID");
assert.equal(finalQuoteAllowed, true, "ELYSIUM_PRESET_QUOTE_NOT_ALLOWED");
assert.equal((preset as { enabled: boolean }).enabled, true, "ELYSIUM_PRESET_DISABLED");
await persist("verified");
console.log(JSON.stringify({
  chainId: plan.chainId,
  planSha256,
  status: "verified",
  transactions: receipts.map(({ transactionHash }) => transactionHash),
  totalFeeHype: formatEther(totalFeeWei),
  capHype: capArg,
  presetCount: finalPresetCount.toString(),
  quoteAllowed: finalQuoteAllowed,
  presetEnabled: (preset as { enabled: boolean }).enabled,
}, null, 2));
