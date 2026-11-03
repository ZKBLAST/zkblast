import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type Tx = { nonce: number; name: string; predictedContractAddress: Address; data: Hex };
type Receipt = { status: Hex; gasUsed: Hex; contractAddress: Address | null; blockNumber: Hex };
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-plan.json"), "utf8")) as {
  chainId: number; deployer: Address; planSha256: string; startingNonce: number; nextNonce: number;
  transactions: Tx[]; gates: { broadcastAllowed: boolean };
};
if (plan.chainId !== 999 || plan.startingNonce !== 55 || plan.nextNonce !== 57 || plan.gates.broadcastAllowed) {
  throw new Error("HYPEREVM_ADAPTER_REGISTRY_SIMULATION_PLAN_INVALID");
}
const url = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18603";
let id = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (payload.error) throw new Error(`${method}:${payload.error.code}:${payload.error.message}:${JSON.stringify(payload.error.data ?? null)}`);
  return payload.result as T;
}
if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== 999) throw new Error("HYPEREVM_ADAPTER_REGISTRY_SIMULATION_CHAIN_INVALID");
const deployer = getAddress(plan.deployer);
if (Number(BigInt(await rpc<Hex>("eth_getTransactionCount", [deployer, "pending"]))) !== 55) throw new Error("HYPEREVM_ADAPTER_REGISTRY_SIMULATION_NONCE_INVALID");
await rpc("anvil_impersonateAccount", [deployer]);
await rpc("anvil_setBalance", [deployer, "0x3635c9adc5dea00000"]);
const receipts: Array<Record<string, unknown>> = [];
for (const tx of plan.transactions) {
  const call = { from: deployer, data: tx.data, nonce: `0x${tx.nonce.toString(16)}` };
  const estimate = BigInt(await rpc<Hex>("eth_estimateGas", [call]));
  const gas = estimate + 100_000n;
  if (gas > 3_000_000n) throw new Error(`HYPEREVM_ADAPTER_REGISTRY_BLOCK_GAS_EXCEEDED:${tx.nonce}:${gas}`);
  const hash = await rpc<Hex>("eth_sendTransaction", [{ ...call, gas: `0x${gas.toString(16)}` }]);
  let receipt: Receipt | null = null;
  for (let attempt = 0; attempt < 30 && !receipt; attempt++) {
    receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!receipt || receipt.status !== "0x1") throw new Error(`HYPEREVM_ADAPTER_REGISTRY_TRANSACTION_FAILED:${tx.nonce}`);
  if (getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(tx.predictedContractAddress)) throw new Error(`HYPEREVM_ADAPTER_REGISTRY_ADDRESS_MISMATCH:${tx.nonce}`);
  receipts.push({ nonce: tx.nonce, name: tx.name, hash, estimatedGas: estimate.toString(), gasLimit: gas.toString(), gasUsed: BigInt(receipt.gasUsed).toString(), blockNumber: BigInt(receipt.blockNumber).toString(), contractAddress: receipt.contractAddress });
}
const report = { schemaVersion: 1, chainId: 999, generatedAt: new Date().toISOString(), sourcePlanSha256: plan.planSha256, startingNonce: 55, nextNonce: 57, transactionCount: receipts.length, blockGasLimit: "3000000", totalGasUsed: receipts.reduce((sum, receipt) => sum + BigInt(String(receipt.gasUsed)), 0n).toString(), receipts, passed: true, broadcastAllowed: false };
await writeFile(path.join(directory, "adapter-registry-deployment-simulation.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: receipts.length, totalGasUsed: report.totalGasUsed, passed: true, broadcastAllowed: false }, null, 2));
