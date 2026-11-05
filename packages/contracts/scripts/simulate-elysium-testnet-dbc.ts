import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type Transaction = Readonly<{
  nonce: number;
  name: string;
  predictedContractAddress?: Address;
  to?: Address;
  data: Hex;
}>;
type Receipt = Readonly<{
  status: Hex;
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  contractAddress: Address | null;
  blockNumber: Hex;
}>;
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const plan = JSON.parse(
  await readFile(path.join(directory, "dbc-deployment-plan.json"), "utf8"),
) as {
  chainId: number;
  deployer: Address;
  planSha256: string;
  startingNonce: number;
  nextNonce: number;
  deployments: Transaction[];
  configurations: Transaction[];
  gates: { broadcastAllowed: boolean };
};
if (
  plan.chainId !== 99_801 ||
  plan.startingNonce !== 1 ||
  plan.nextNonce !== 22 ||
  plan.gates.broadcastAllowed
) {
  throw new Error("ELYSIUM_DBC_SIMULATION_PLAN_INVALID");
}
const url = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18555";
let id = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (payload.error)
    throw new Error(
      `${method}:${payload.error.code}:${payload.error.message}:${JSON.stringify(payload.error.data ?? null)}`,
    );
  return payload.result as T;
}
if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== 99_801)
  throw new Error("ELYSIUM_DBC_SIMULATION_CHAIN_INVALID");
const deployer = getAddress(plan.deployer);
if (
  Number(BigInt(await rpc<Hex>("eth_getTransactionCount", [deployer, "pending"]))) !==
  plan.startingNonce
) {
  throw new Error("ELYSIUM_DBC_SIMULATION_NONCE_INVALID");
}
await rpc("anvil_impersonateAccount", [deployer]);
await rpc("anvil_setBalance", [deployer, "0x8ac7230489e80000"]);
const transactions = [...plan.deployments, ...plan.configurations].sort(
  (left, right) => left.nonce - right.nonce,
);
const receipts: Record<string, unknown>[] = [];
for (const transaction of transactions) {
  const call = {
    from: deployer,
    ...(transaction.to ? { to: transaction.to } : {}),
    data: transaction.data,
    nonce: `0x${transaction.nonce.toString(16)}`,
  };
  const estimatedGas = BigInt(await rpc<Hex>("eth_estimateGas", [call]));
  const gasLimit = estimatedGas + 100_000n;
  if (gasLimit > 30_000_000n)
    throw new Error(`ELYSIUM_DBC_GAS_BOUND_EXCEEDED:${transaction.name}`);
  const hash = await rpc<Hex>("eth_sendTransaction", [
    { ...call, gas: `0x${gasLimit.toString(16)}` },
  ]);
  let receipt: Receipt | null = null;
  for (let attempt = 0; attempt < 30 && !receipt; attempt += 1) {
    receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!receipt || receipt.status !== "0x1")
    throw new Error(`ELYSIUM_DBC_TRANSACTION_FAILED:${transaction.name}`);
  if (
    transaction.predictedContractAddress &&
    getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !==
      getAddress(transaction.predictedContractAddress)
  ) {
    throw new Error(`ELYSIUM_DBC_ADDRESS_MISMATCH:${transaction.name}`);
  }
  receipts.push({
    nonce: transaction.nonce,
    name: transaction.name,
    hash,
    estimatedGas: estimatedGas.toString(),
    gasLimit: gasLimit.toString(),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice).toString(),
    contractAddress: receipt.contractAddress,
    blockNumber: BigInt(receipt.blockNumber).toString(),
  });
}
const totalGasUsed = receipts.reduce(
  (total, receipt) => total + BigInt(String(receipt.gasUsed)),
  0n,
);
const report = {
  schemaVersion: 1,
  chainId: 99_801,
  generatedAt: new Date().toISOString(),
  sourcePlanSha256: plan.planSha256,
  transactionCount: receipts.length,
  startingNonce: plan.startingNonce,
  nextNonce: plan.nextNonce,
  totalGasUsed: totalGasUsed.toString(),
  receipts,
  passed: true,
  broadcastAllowed: false,
};
await writeFile(
  path.join(directory, "dbc-deployment-simulation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(JSON.stringify({
  transactionCount: report.transactionCount,
  totalGasUsed: report.totalGasUsed,
  sourcePlanSha256: report.sourcePlanSha256,
  passed: report.passed,
  broadcastAllowed: false,
}, null, 2));
