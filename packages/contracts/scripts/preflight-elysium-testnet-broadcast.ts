import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatEther, getAddress, parseEther, type Address, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const candidate = JSON.parse(await readFile(path.join(directory, "manifest-candidate.json"), "utf8")) as {
  chainId: number;
  deployer: Address;
  transactionCount: number;
  startingNonce: number;
  candidateSha256: string;
  gas: { combinedGasUsed: string; retryBufferBps: number };
  gates: { broadcastAllowed: boolean };
};
const rpcUrl = process.env.ELYSIUM_PRIVATE_RPC_URL ?? process.env.ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";
const approvedHash = process.env.ELYSIUM_APPROVED_CANDIDATE_SHA256;
const maximumSpendHype = process.env.ELYSIUM_MAX_DEPLOYMENT_HYPE;
if (candidate.chainId !== 99_801 || candidate.startingNonce !== 0 || candidate.transactionCount !== 63 || candidate.gates.broadcastAllowed) throw new Error("ELYSIUM_BROADCAST_CANDIDATE_INVALID");
if (!approvedHash || approvedHash !== candidate.candidateSha256) throw new Error("ELYSIUM_BROADCAST_PLAN_NOT_APPROVED");
if (!maximumSpendHype || !/^\d+(?:\.\d{1,18})?$/u.test(maximumSpendHype)) throw new Error("ELYSIUM_MAX_DEPLOYMENT_HYPE_REQUIRED");
const approvedMaximumSpendWei = parseEther(maximumSpendHype);
let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
  if (payload.error) throw new Error(`${method}:${payload.error.code}:${payload.error.message}`);
  return payload.result as T;
}
const chainId = Number(BigInt(await rpc<Hex>("eth_chainId")));
if (chainId !== candidate.chainId) throw new Error("ELYSIUM_BROADCAST_RPC_CHAIN_MISMATCH");
const deployer = getAddress(candidate.deployer);
const [pendingNonceHex, balanceHex, gasPriceHex, blockHex] = await Promise.all([
  rpc<Hex>("eth_getTransactionCount", [deployer, "pending"]),
  rpc<Hex>("eth_getBalance", [deployer, "latest"]),
  rpc<Hex>("eth_gasPrice"),
  rpc<Hex>("eth_blockNumber"),
]);
const pendingNonce = Number(BigInt(pendingNonceHex));
const balanceWei = BigInt(balanceHex);
const gasPriceWei = BigInt(gasPriceHex);
if (pendingNonce !== candidate.startingNonce) throw new Error(`ELYSIUM_BROADCAST_NONCE_CHANGED:${pendingNonce}`);
const measuredGas = BigInt(candidate.gas.combinedGasUsed);
const requiredMaximumSpendWei = measuredGas * gasPriceWei * BigInt(10_000 + candidate.gas.retryBufferBps) / 10_000n;
if (requiredMaximumSpendWei > approvedMaximumSpendWei) throw new Error(`ELYSIUM_BROADCAST_SPEND_CAP_EXCEEDED:${formatEther(requiredMaximumSpendWei)}`);
if (balanceWei < approvedMaximumSpendWei) throw new Error(`ELYSIUM_BROADCAST_BALANCE_INSUFFICIENT:${formatEther(balanceWei)}`);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chainId,
  referenceBlock: Number(BigInt(blockHex)),
  deployer,
  pendingNonce,
  balanceWei: balanceWei.toString(),
  gasPriceWei: gasPriceWei.toString(),
  measuredGas: measuredGas.toString(),
  requiredMaximumSpendWei: requiredMaximumSpendWei.toString(),
  approvedMaximumSpendWei: approvedMaximumSpendWei.toString(),
  candidateSha256: candidate.candidateSha256,
  transactionCount: candidate.transactionCount,
  checks: { chain: true, candidateHash: true, nonce: true, spendCap: true, balance: true },
  broadcastAllowed: false,
  note: "Preflight success does not broadcast or authorize transactions; the executor must repeat every check immediately before signing.",
};
await writeFile(path.join(directory, "broadcast-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ chainId, transactionCount: report.transactionCount, requiredMaximumSpendHype: formatEther(requiredMaximumSpendWei), approvedMaximumSpendHype: maximumSpendHype, candidateSha256: report.candidateSha256, broadcastAllowed: false }, null, 2));
