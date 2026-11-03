import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type Transaction = Readonly<{ nonce: number; name: string; predictedContractAddress?: Address; data: Hex }>;
type Receipt = Readonly<{ status: Hex; gasUsed: Hex; contractAddress: Address | null; blockNumber: Hex }>;
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "core-resume-plan.json"), "utf8")) as { chainId: number; deployer: Address; planSha256: string; startingNonce: number; transactions: Transaction[]; gates: { broadcastAllowed: boolean } };
if (plan.chainId !== 999 || plan.startingNonce !== 3 || plan.transactions.length !== 7 || plan.gates.broadcastAllowed) throw new Error("HYPEREVM_CORE_RESUME_SIMULATION_PLAN_INVALID");
const rpcUrl = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18601";
let id = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (payload.error) throw new Error(`${method}:${payload.error.code}:${payload.error.message}:${JSON.stringify(payload.error.data ?? null)}`);
  return payload.result as T;
}
if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== 999) throw new Error("HYPEREVM_CORE_RESUME_SIMULATION_CHAIN_INVALID");
const deployer = getAddress(plan.deployer);
if (Number(BigInt(await rpc<Hex>("eth_getTransactionCount", [deployer, "pending"]))) !== 3) throw new Error("HYPEREVM_CORE_RESUME_SIMULATION_NONCE_INVALID");
await rpc("anvil_impersonateAccount", [deployer]);
await rpc("anvil_setBalance", [deployer, "0x3635c9adc5dea00000"]);
const receipts: Array<Record<string, unknown>> = [];
for (const transaction of plan.transactions) {
  const estimate = BigInt(await rpc<Hex>("eth_estimateGas", [{ from: deployer, data: transaction.data, nonce: `0x${transaction.nonce.toString(16)}` }]));
  const gas = (estimate * 105n + 99n) / 100n;
  if (gas > 3_000_000n) throw new Error(`HYPEREVM_CORE_RESUME_BLOCK_GAS_EXCEEDED:${transaction.nonce}:${gas}`);
  const hash = await rpc<Hex>("eth_sendTransaction", [{ from: deployer, data: transaction.data, nonce: `0x${transaction.nonce.toString(16)}`, gas: `0x${gas.toString(16)}` }]);
  let receipt: Receipt | null = null;
  for (let attempt = 0; attempt < 30 && !receipt; attempt += 1) {
    receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!receipt || receipt.status !== "0x1") throw new Error(`HYPEREVM_CORE_RESUME_TRANSACTION_FAILED:${transaction.nonce}`);
  if (transaction.predictedContractAddress && getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(transaction.predictedContractAddress)) throw new Error(`HYPEREVM_CORE_RESUME_ADDRESS_MISMATCH:${transaction.nonce}`);
  receipts.push({ nonce: transaction.nonce, name: transaction.name, hash, estimatedGas: estimate.toString(), gasLimit: gas.toString(), gasUsed: BigInt(receipt.gasUsed).toString(), contractAddress: receipt.contractAddress, blockNumber: BigInt(receipt.blockNumber).toString() });
}
const totalGasUsed = receipts.reduce((sum, receipt) => sum + BigInt(String(receipt.gasUsed)), 0n);
const report = { schemaVersion: 1, chainId: 999, kind: "partial-core-resume-fork-simulation", generatedAt: new Date().toISOString(), sourcePlanSha256: plan.planSha256, startingNonce: 3, nextNonce: 10, transactionCount: receipts.length, blockGasLimit: "3000000", totalGasUsed: totalGasUsed.toString(), receipts, passed: true, broadcastAllowed: false };
await writeFile(path.join(directory, "core-resume-simulation.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: receipts.length, totalGasUsed: report.totalGasUsed, maximumEstimatedGas: receipts.reduce((max, receipt) => BigInt(String(receipt.estimatedGas)) > max ? BigInt(String(receipt.estimatedGas)) : max, 0n).toString(), blockGasLimit: report.blockGasLimit, passed: true, broadcastAllowed: false }, null, 2));
