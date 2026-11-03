import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Transaction = { nonce: number; name: string; predictedContractAddress: Address; data: Hex };
const expectedHash = "ec83be5a8823437c6863c327b619c92cffcae4ddf7e762dafcd2f567f14c59cb";
const capWei = 500_000_000_000_000n;
const expectedDeployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");

if (!process.argv.includes("--broadcast") || !process.argv.includes(`--approve-plan=${expectedHash}`) || !process.argv.includes("--cap-hype=0.0005")) throw new Error("HYPEREVM_ADAPTER_REGISTRY_EXPLICIT_APPROVAL_REQUIRED");
if (!process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY) throw new Error("HYPEREVM_ADAPTER_REGISTRY_ENV_REQUIRED");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
if (getAddress(account.address) !== expectedDeployer) throw new Error("HYPEREVM_ADAPTER_REGISTRY_SIGNER_INVALID");

const plan = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-plan.json"), "utf8")) as { chainId: number; deployer: Address; planSha256: string; startingNonce: number; nextNonce: number; transactionCount: number; transactions: Transaction[] };
const simulation = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-simulation.json"), "utf8")) as { sourcePlanSha256: string; passed: boolean; transactionCount: number; receipts: Array<{ nonce: number; gasLimit: string }> };
if (plan.chainId !== 999 || getAddress(plan.deployer) !== expectedDeployer || plan.planSha256 !== expectedHash || simulation.sourcePlanSha256 !== expectedHash || !simulation.passed || plan.startingNonce !== 55 || plan.nextNonce !== 57 || plan.transactionCount !== 2 || simulation.transactionCount !== 2) throw new Error("HYPEREVM_ADAPTER_REGISTRY_EVIDENCE_INVALID");
const transactions = [...plan.transactions].sort((a, b) => a.nonce - b.nonce);
if (transactions.some((tx, index) => tx.nonce !== 55 + index)) throw new Error("HYPEREVM_ADAPTER_REGISTRY_NONCE_SEQUENCE_INVALID");

const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== 999) throw new Error("HYPEREVM_ADAPTER_REGISTRY_CHAIN_INVALID");
const gasLimits = new Map(simulation.receipts.map((receipt) => [receipt.nonce, BigInt(receipt.gasLimit)]));
const addresses = transactions.map((tx) => getAddress(tx.predictedContractAddress));
const [nonce, balance, gasPrice, codes] = await Promise.all([
  publicClient.getTransactionCount({ address: expectedDeployer, blockTag: "pending" }),
  publicClient.getBalance({ address: expectedDeployer }),
  publicClient.getGasPrice(),
  Promise.all(addresses.map((address) => publicClient.getCode({ address }))),
]);
if (nonce !== 55 || codes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_ADAPTER_REGISTRY_LIVE_STATE_INVALID");
const maximumFeeWei = transactions.reduce((sum, tx) => {
  const gas = gasLimits.get(tx.nonce);
  if (!gas || gas > 3_000_000n) throw new Error(`HYPEREVM_ADAPTER_REGISTRY_GAS_INVALID:${tx.nonce}`);
  return sum + gas * gasPrice;
}, 0n);
if (maximumFeeWei > capWei || balance < capWei) throw new Error("HYPEREVM_ADAPTER_REGISTRY_CAP_EXCEEDED");

const journalPath = path.join(directory, "adapter-registry-broadcast.private.json");
const journal: { planSha256: string; startedAt: string; maximumFeeHype: string; transactions: Array<Record<string, unknown>> } = { planSha256: expectedHash, startedAt: new Date().toISOString(), maximumFeeHype: formatEther(maximumFeeWei), transactions: [] };
const save = () => writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
await save();
for (const tx of transactions) {
  const hash = await walletClient.sendTransaction({ account, chain: null, data: tx.data, gas: gasLimits.get(tx.nonce)!, gasPrice, nonce: tx.nonce });
  journal.transactions.push({ nonce: tx.nonce, name: tx.name, hash, state: "submitted" });
  await save();
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`HYPEREVM_ADAPTER_REGISTRY_REVERTED:${tx.nonce}`);
  if (getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(tx.predictedContractAddress)) throw new Error(`HYPEREVM_ADAPTER_REGISTRY_ADDRESS_MISMATCH:${tx.nonce}`);
  journal.transactions[journal.transactions.length - 1] = { nonce: tx.nonce, name: tx.name, hash, state: "confirmed", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress };
  await save();
}
const totalFeeWei = journal.transactions.reduce((sum, tx) => sum + BigInt(String(tx.gasUsed)) * BigInt(String(tx.effectiveGasPrice)), 0n);
if (totalFeeWei > capWei) throw new Error("HYPEREVM_ADAPTER_REGISTRY_ACTUAL_FEE_EXCEEDED");
console.log(JSON.stringify({ confirmedTransactions: 2, nextNonce: 57, totalFeeHype: formatEther(totalFeeWei), journal: "deployments/hyperevm-mainnet/adapter-registry-broadcast.private.json" }, null, 2));
