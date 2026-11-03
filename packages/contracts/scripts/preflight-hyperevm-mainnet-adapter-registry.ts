import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, formatEther, getAddress, http, type Address } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-plan.json"), "utf8")) as {
  chainId: number; deployer: Address; planSha256: string; startingNonce: number; nextNonce: number;
  transactions: Array<{ predictedContractAddress: Address }>;
};
const simulation = JSON.parse(await readFile(path.join(directory, "adapter-registry-deployment-simulation.json"), "utf8")) as {
  sourcePlanSha256: string; passed: boolean; totalGasUsed: string; receipts: Array<{ gasLimit: string }>;
};
if (plan.chainId !== 999 || plan.startingNonce !== 55 || plan.nextNonce !== 57 || simulation.sourcePlanSha256 !== plan.planSha256 || !simulation.passed) throw new Error("HYPEREVM_ADAPTER_REGISTRY_PREFLIGHT_EVIDENCE_INVALID");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_ADAPTER_REGISTRY_PREFLIGHT_CHAIN_INVALID");
const deployer = getAddress(plan.deployer);
const addresses = plan.transactions.map((tx) => getAddress(tx.predictedContractAddress));
const [block, nonce, balance, gasPrice, codes] = await Promise.all([
  client.getBlock(),
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBalance({ address: deployer }),
  client.getGasPrice(),
  Promise.all(addresses.map((address) => client.getCode({ address }))),
]);
if (nonce !== 55 || codes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_ADAPTER_REGISTRY_PREFLIGHT_STATE_INVALID");
const aggregateGasLimit = simulation.receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasLimit), 0n);
const maximumFeeWei = aggregateGasLimit * gasPrice;
const proposedCapWei = 500_000_000_000_000n;
if (maximumFeeWei > proposedCapWei || balance < proposedCapWei) throw new Error("HYPEREVM_ADAPTER_REGISTRY_PREFLIGHT_CAP_INVALID");
const report = { schemaVersion: 1, chainId: 999, generatedAt: new Date().toISOString(), referenceBlock: block.number.toString(), deployer, pendingNonce: nonce, balanceHype: formatEther(balance), planSha256: plan.planSha256, transactionCount: 2, predictedAddressCount: addresses.length, gasPriceWei: gasPrice.toString(), simulatedGasUsed: simulation.totalGasUsed, aggregateGasLimit: aggregateGasLimit.toString(), maximumFeeHype: formatEther(maximumFeeWei), proposedCapHype: "0.0005", checks: { simulationPassed: true, nonceMatches: true, predictedAddressesEmpty: true, privateKeysRead: false, broadcastAllowed: false, separateApprovalRequired: true } };
await writeFile(path.join(directory, "adapter-registry-deployment-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(report, null, 2));
