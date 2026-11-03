import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type PlannedTransaction = Readonly<{
  name?: string;
  description?: string;
  nonce: number;
  predictedContractAddress?: Address;
  to?: Address;
  target?: Address;
  data: Hex;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const expectedPlanHash = "796f14804049a0b8a24e42d07506a3e2590aa9a788a4120435b00560659a15b3";
const expectedDeployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
const approvedCapWei = 13_000_000_000_000_000n;
const approval = process.argv.find((argument) => argument.startsWith("--approve-plan="))?.split("=")[1];
const cap = process.argv.find((argument) => argument.startsWith("--cap-hype="))?.split("=")[1];

if (!process.argv.includes("--broadcast")) throw new Error("HYPEREVM_BROADCAST_FLAG_REQUIRED");
if (approval !== expectedPlanHash) throw new Error("HYPEREVM_EXACT_PLAN_APPROVAL_REQUIRED");
if (cap !== "0.013") throw new Error("HYPEREVM_EXACT_CAP_REQUIRED");
if (!process.env.RPC_URL) throw new Error("HYPEREVM_RPC_REQUIRED");
if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("HYPEREVM_DEPLOYER_PRIVATE_KEY_REQUIRED");
if (process.env.GOVERNANCE_PRIVATE_KEY || process.env.UPGRADER_PRIVATE_KEY) {
  throw new Error("HYPEREVM_BROADCAST_REJECTS_UNNEEDED_KEYS");
}

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
if (getAddress(account.address) !== expectedDeployer) throw new Error("HYPEREVM_DEPLOYER_KEY_MISMATCH");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(directory, file), "utf8")) as T;
const aggregate = await read<{ chainId: number; planSha256: string; transactionCount: number; startingNonce: number; nextNonce: number; gates: { broadcastAllowed: boolean } }>("aggregate-deployment-plan.json");
const decision = await read<{ economics: { approved: boolean }; capabilities: { dammActivationApproved: boolean; adapterRegistryReviewRecordApproved: boolean; dlmmEnabled: boolean; zkEnabled: boolean }; riskBoundary: { maximumSpendHype: string; broadcastRequiresSeparateApproval: boolean } }>("release-decision.json");
const verification = await read<{ passed: boolean; transactionCount: number; totalGasUsed: string }>("sequential-simulation-verification.json");
const simulation = await read<{ sourcePlanSha256: string; receipts: ReadonlyArray<Readonly<{ nonce: number; gasLimit: string }>> }>("sequential-simulation.json");
if (
  aggregate.chainId !== 999 || aggregate.planSha256 !== expectedPlanHash || aggregate.transactionCount !== 56 ||
  aggregate.startingNonce !== 0 || aggregate.nextNonce !== 56 || aggregate.gates.broadcastAllowed ||
  !decision.economics.approved || !decision.capabilities.dammActivationApproved ||
  decision.capabilities.adapterRegistryReviewRecordApproved || decision.capabilities.dlmmEnabled || decision.capabilities.zkEnabled ||
  decision.riskBoundary.maximumSpendHype !== "0.013" || !decision.riskBoundary.broadcastRequiresSeparateApproval ||
  !verification.passed || verification.transactionCount !== 56 || verification.totalGasUsed !== "48154670" ||
  simulation.sourcePlanSha256 !== expectedPlanHash || simulation.receipts.length !== 56
) throw new Error("HYPEREVM_BROADCAST_EVIDENCE_INVALID");

const core = await read<{ transactions: PlannedTransaction[] }>("core-deployment-plan.json");
const dbc = await read<{ deployments: PlannedTransaction[]; configurations: PlannedTransaction[] }>("dbc-deployment-plan.json");
const launchpad = await read<{ deployments: PlannedTransaction[]; configurations: PlannedTransaction[] }>("launchpad-deployment-plan.json");
const adapter = await read<{ transactions: PlannedTransaction[] }>("adapter-registry-deployment-plan.json");
const transactions = [...core.transactions, ...dbc.deployments, ...dbc.configurations, ...launchpad.deployments, ...launchpad.configurations, ...adapter.transactions].sort((left, right) => left.nonce - right.nonce);
if (transactions.length !== 56 || transactions.some((transaction, index) => transaction.nonce !== index)) throw new Error("HYPEREVM_BROADCAST_NONCE_SEQUENCE_INVALID");
const predictedAddresses = transactions
  .flatMap((transaction) => transaction.predictedContractAddress ? [getAddress(transaction.predictedContractAddress)] : []);
if (predictedAddresses.length !== 41 || new Set(predictedAddresses).size !== 41) throw new Error("HYPEREVM_BROADCAST_ADDRESS_SET_INVALID");

const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== 999) throw new Error("HYPEREVM_BROADCAST_CHAIN_MISMATCH");
const [pendingNonce, balance, gasPrice, predictedCodes] = await Promise.all([
  publicClient.getTransactionCount({ address: expectedDeployer, blockTag: "pending" }),
  publicClient.getBalance({ address: expectedDeployer }),
  publicClient.getGasPrice(),
  Promise.all(predictedAddresses.map((address) => publicClient.getCode({ address }))),
]);
if (pendingNonce !== 0) throw new Error(`HYPEREVM_BROADCAST_NONCE_CHANGED:${pendingNonce}`);
if (balance < approvedCapWei) throw new Error("HYPEREVM_BROADCAST_BALANCE_BELOW_CAP");
if (predictedCodes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_BROADCAST_PREDICTED_ADDRESS_OCCUPIED");
const gasLimits = new Map(simulation.receipts.map((receipt) => [receipt.nonce, BigInt(receipt.gasLimit)]));
const maximumFeeWei = transactions.reduce((total, transaction) => total + (gasLimits.get(transaction.nonce) ?? 0n) * gasPrice, 0n);
if (maximumFeeWei > approvedCapWei) throw new Error("HYPEREVM_BROADCAST_MAXIMUM_FEE_EXCEEDS_CAP");

const journalPath = path.join(directory, "broadcast-journal.private.json");
const journal: { schemaVersion: number; chainId: number; planSha256: string; startedAt: string; gasPriceWei: string; maximumFeeWei: string; maximumFeeHype: string; transactions: Array<Record<string, unknown>> } = {
  schemaVersion: 1, chainId: 999, planSha256: expectedPlanHash, startedAt: new Date().toISOString(), gasPriceWei: gasPrice.toString(), maximumFeeWei: maximumFeeWei.toString(), maximumFeeHype: formatEther(maximumFeeWei), transactions: [],
};
await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
for (const transaction of transactions) {
  const target = transaction.to ?? transaction.target;
  const gas = gasLimits.get(transaction.nonce);
  if (!gas) throw new Error(`HYPEREVM_BROADCAST_GAS_LIMIT_MISSING:${transaction.nonce}`);
  const hash = await walletClient.sendTransaction({ account, chain: null, ...(target ? { to: getAddress(target) } : {}), data: transaction.data, gas, gasPrice, nonce: transaction.nonce });
  journal.transactions.push({ nonce: transaction.nonce, name: transaction.name ?? transaction.description, hash, state: "submitted" });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`HYPEREVM_BROADCAST_TRANSACTION_REVERTED:${transaction.nonce}:${hash}`);
  if (transaction.predictedContractAddress && getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(transaction.predictedContractAddress)) throw new Error(`HYPEREVM_BROADCAST_ADDRESS_MISMATCH:${transaction.nonce}`);
  journal.transactions[journal.transactions.length - 1] = { nonce: transaction.nonce, name: transaction.name ?? transaction.description, hash, state: "confirmed", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress };
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
}
const totalFeeWei = journal.transactions.reduce((total, transaction) => total + BigInt(String(transaction.gasUsed)) * BigInt(String(transaction.effectiveGasPrice)), 0n);
if (totalFeeWei > approvedCapWei) throw new Error("HYPEREVM_BROADCAST_ACTUAL_FEE_EXCEEDS_CAP");
console.log(JSON.stringify({ chainId: 999, planSha256: expectedPlanHash, confirmedTransactions: journal.transactions.length, totalFeeWei: totalFeeWei.toString(), totalFeeHype: formatEther(totalFeeWei), journal: "deployments/hyperevm-mainnet/broadcast-journal.private.json" }, null, 2));
