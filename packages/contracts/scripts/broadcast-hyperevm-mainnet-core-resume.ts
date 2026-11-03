import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const expectedHash = "86a0c05a88e8a6a7962ffe535050459b715e288dffa9fb61ad54ce29bf1692b2";
const capWei = 2_500_000_000_000_000n;
if (!process.argv.includes("--broadcast") || !process.argv.includes(`--approve-plan=${expectedHash}`) || !process.argv.includes("--cap-hype=0.0025")) throw new Error("HYPEREVM_CORE_RESUME_EXPLICIT_APPROVAL_REQUIRED");
if (!process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY) throw new Error("HYPEREVM_CORE_RESUME_ENV_REQUIRED");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const deployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
if (getAddress(account.address) !== deployer) throw new Error("HYPEREVM_CORE_RESUME_SIGNER_INVALID");
const plan = JSON.parse(await readFile(path.join(directory, "core-resume-plan.json"), "utf8")) as { planSha256: string; transactions: Array<{ nonce: number; name: string; predictedContractAddress?: Address; data: Hex }> };
const simulation = JSON.parse(await readFile(path.join(directory, "core-resume-simulation.json"), "utf8")) as { sourcePlanSha256: string; passed: boolean; receipts: Array<{ nonce: number; gasLimit: string }> };
if (plan.planSha256 !== expectedHash || simulation.sourcePlanSha256 !== expectedHash || !simulation.passed || plan.transactions.length !== 7) throw new Error("HYPEREVM_CORE_RESUME_EVIDENCE_INVALID");
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== 999) throw new Error("HYPEREVM_CORE_RESUME_CHAIN_INVALID");
const gasLimits = new Map(simulation.receipts.map((receipt) => [receipt.nonce, BigInt(receipt.gasLimit)]));
const [nonce, balance, gasPrice, pendingCodes] = await Promise.all([
  publicClient.getTransactionCount({ address: deployer, blockTag: "pending" }), publicClient.getBalance({ address: deployer }), publicClient.getGasPrice(),
  Promise.all(plan.transactions.map((transaction) => transaction.predictedContractAddress ? publicClient.getCode({ address: transaction.predictedContractAddress }) : Promise.resolve(undefined))),
]);
if (nonce !== 3) throw new Error(`HYPEREVM_CORE_RESUME_NONCE_INVALID:${nonce}`);
if (pendingCodes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_CORE_RESUME_ADDRESS_OCCUPIED");
const maximumFeeWei = plan.transactions.reduce((sum, transaction) => sum + (gasLimits.get(transaction.nonce) ?? 0n) * gasPrice, 0n);
if (maximumFeeWei > capWei || balance < capWei) throw new Error("HYPEREVM_CORE_RESUME_CAP_EXCEEDED");
const journalPath = path.join(directory, "core-resume-broadcast.private.json");
const journal: { planSha256: string; startedAt: string; maximumFeeHype: string; transactions: Array<Record<string, unknown>> } = { planSha256: expectedHash, startedAt: new Date().toISOString(), maximumFeeHype: formatEther(maximumFeeWei), transactions: [] };
await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
for (const transaction of plan.transactions) {
  const gas = gasLimits.get(transaction.nonce);
  if (!gas || gas > 3_000_000n) throw new Error(`HYPEREVM_CORE_RESUME_GAS_INVALID:${transaction.nonce}`);
  const hash = await walletClient.sendTransaction({ account, chain: null, data: transaction.data, gas, gasPrice, nonce: transaction.nonce });
  journal.transactions.push({ nonce: transaction.nonce, name: transaction.name, hash, state: "submitted" });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`HYPEREVM_CORE_RESUME_REVERTED:${transaction.nonce}`);
  if (transaction.predictedContractAddress && getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(transaction.predictedContractAddress)) throw new Error(`HYPEREVM_CORE_RESUME_ADDRESS_MISMATCH:${transaction.nonce}`);
  journal.transactions[journal.transactions.length - 1] = { nonce: transaction.nonce, name: transaction.name, hash, state: "confirmed", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress };
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
}
const fee = journal.transactions.reduce((sum, transaction) => sum + BigInt(String(transaction.gasUsed)) * BigInt(String(transaction.effectiveGasPrice)), 0n);
console.log(JSON.stringify({ confirmedTransactions: journal.transactions.length, nextNonce: 10, totalFeeHype: formatEther(fee), journal: "deployments/hyperevm-mainnet/core-resume-broadcast.private.json" }, null, 2));
