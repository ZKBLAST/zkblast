import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type PlannedTransaction = Readonly<{ name?: string; description?: string; nonce: number; predictedContractAddress?: Address; to?: Address; target?: Address; data: Hex }>;
type TransactionReceipt = Readonly<{ status: Hex; gasUsed: Hex; contractAddress: Address | null; blockNumber: Hex }>;
const root = path.resolve(import.meta.dirname, "../../..");
const rpcUrl = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18599";
let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (payload.error) throw new Error(`${method}:${payload.error.code}:${payload.error.message}:${JSON.stringify(payload.error.data ?? null)}`);
  return payload.result as T;
}
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, "deployments/hyperevm-mainnet", file), "utf8")) as T;
const core = await readJson<{ chainId: number; deployer: Address; transactions: PlannedTransaction[] }>("core-deployment-plan.json");
const dbc = await readJson<{ deployments: PlannedTransaction[]; configurations: PlannedTransaction[] }>("dbc-deployment-plan.json");
const launchpad = await readJson<{ deployments: PlannedTransaction[]; configurations: PlannedTransaction[] }>("launchpad-deployment-plan.json");
const adapter = await readJson<{ transactions: PlannedTransaction[] }>("adapter-registry-deployment-plan.json");
const aggregate = await readJson<{ transactionCount: number; planSha256: string; gates: { broadcastAllowed: boolean } }>("aggregate-deployment-plan.json");
if (core.chainId !== 999 || aggregate.gates.broadcastAllowed || aggregate.transactionCount !== 56) throw new Error("HYPEREVM_SIMULATION_PLAN_INVALID");
const chainId = Number(BigInt(await rpc<Hex>("eth_chainId")));
if (chainId !== 999) throw new Error(`HYPEREVM_SIMULATION_CHAIN_MISMATCH:${chainId}`);
const deployer = getAddress(core.deployer);
await rpc("anvil_impersonateAccount", [deployer]);
await rpc("anvil_setBalance", [deployer, "0x3635c9adc5dea00000"]);
await rpc("anvil_setNonce", [deployer, "0x0"]);
const transactions: PlannedTransaction[] = [...core.transactions, ...dbc.deployments, ...dbc.configurations, ...launchpad.deployments, ...launchpad.configurations, ...adapter.transactions];
transactions.sort((a, b) => a.nonce - b.nonce);
if (transactions.length !== 56 || transactions.some((transaction, index) => transaction.nonce !== index)) throw new Error("HYPEREVM_SIMULATION_NONCE_SEQUENCE_INVALID");
const receipts: Array<Record<string, unknown>> = [];
for (const transaction of transactions) {
  const target = transaction.to ?? transaction.target;
  const call = { from: deployer, ...(target ? { to: target } : {}), data: transaction.data, nonce: `0x${transaction.nonce.toString(16)}` };
  const estimatedGas = BigInt(await rpc<Hex>("eth_estimateGas", [call]));
  const gas = (estimatedGas * 125n + 99n) / 100n;
  const hash = await rpc<Hex>("eth_sendTransaction", [{ ...call, gas: `0x${gas.toString(16)}` }]);
  let receipt: TransactionReceipt | null = null;
  for (let attempt = 0; attempt < 20 && !receipt; attempt += 1) {
    receipt = await rpc<TransactionReceipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!receipt || receipt.status !== "0x1") throw new Error(`HYPEREVM_SIMULATION_TRANSACTION_FAILED:${transaction.nonce}:${transaction.name ?? transaction.description}`);
  if (transaction.predictedContractAddress && getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(transaction.predictedContractAddress)) throw new Error(`HYPEREVM_SIMULATION_ADDRESS_MISMATCH:${transaction.nonce}`);
  receipts.push({ nonce: transaction.nonce, name: transaction.name ?? transaction.description, hash, to: target ?? null, contractAddress: receipt.contractAddress, estimatedGas: estimatedGas.toString(), gasLimit: gas.toString(), gasUsed: BigInt(receipt.gasUsed).toString(), blockNumber: BigInt(receipt.blockNumber).toString() });
}
const totalGasUsed = receipts.reduce((total, receipt) => total + BigInt(receipt.gasUsed as string), 0n);
const report = { schemaVersion: 1, chainId: 999, kind: "local-fork-sequential-simulation", generatedAt: new Date().toISOString(), sourcePlanSha256: aggregate.planSha256, deployer, transactionCount: receipts.length, totalGasUsed: totalGasUsed.toString(), suggestedGasLimitWith25PercentBuffer: ((totalGasUsed * 125n + 99n) / 100n).toString(), receipts, verification: { nonceSequence: true, receiptStatus: true, predictedAddresses: true }, gates: { mainnetBroadcastAllowed: false, privateKeysRead: false } };
const serialized = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(path.join(root, "deployments/hyperevm-mainnet/sequential-simulation.json"), serialized, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: receipts.length, totalGasUsed: report.totalGasUsed, suggestedGasLimitWith25PercentBuffer: report.suggestedGasLimitWith25PercentBuffer, reportSha256: createHash("sha256").update(serialized).digest("hex"), mainnetBroadcastAllowed: false }, null, 2));
