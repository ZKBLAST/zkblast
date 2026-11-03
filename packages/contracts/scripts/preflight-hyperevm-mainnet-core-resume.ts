import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, formatEther, getAddress, http, type Address } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const plan = JSON.parse(await readFile(path.join(directory, "core-resume-plan.json"), "utf8")) as { chainId: number; deployer: Address; planSha256: string; startingNonce: number; nextNonce: number; transactions: Array<{ nonce: number; predictedContractAddress?: Address }> };
const simulation = JSON.parse(await readFile(path.join(directory, "core-resume-simulation.json"), "utf8")) as { sourcePlanSha256: string; passed: boolean; transactionCount: number; totalGasUsed: string; receipts: Array<{ nonce: number; gasLimit: string }> };
if (plan.chainId !== 999 || plan.startingNonce !== 3 || plan.nextNonce !== 10 || simulation.sourcePlanSha256 !== plan.planSha256 || !simulation.passed || simulation.transactionCount !== 7) throw new Error("HYPEREVM_CORE_RESUME_PREFLIGHT_EVIDENCE_INVALID");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_CORE_RESUME_PREFLIGHT_CHAIN_INVALID");
const deployer = getAddress(plan.deployer);
const expectedConfirmed = [
  "0x54Ad8502759C61596c428054660674E0ec919F10",
  "0x1a8C1E85382eF7fb5Eca49A289B8CcEfDa46A9CB",
  "0xB07Add5366e4689898dD55f3043B845283DFD3FE",
].map(getAddress);
const pendingAddresses = plan.transactions.flatMap((transaction) => transaction.predictedContractAddress ? [getAddress(transaction.predictedContractAddress)] : []);
const [block, nonce, balance, gasPrice, confirmedCodes, pendingCodes] = await Promise.all([
  client.getBlock(), client.getTransactionCount({ address: deployer, blockTag: "pending" }), client.getBalance({ address: deployer }), client.getGasPrice(),
  Promise.all(expectedConfirmed.map((address) => client.getCode({ address }))),
  Promise.all(pendingAddresses.map((address) => client.getCode({ address }))),
]);
if (nonce !== 3) throw new Error(`HYPEREVM_CORE_RESUME_PREFLIGHT_NONCE_INVALID:${nonce}`);
if (confirmedCodes.some((code) => !code || code === "0x")) throw new Error("HYPEREVM_CORE_RESUME_CONFIRMED_CODE_MISSING");
if (pendingCodes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_CORE_RESUME_ADDRESS_OCCUPIED");
const gasLimit = simulation.receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasLimit), 0n);
const maximumFeeWei = gasLimit * gasPrice;
const capWei = 2_500_000_000_000_000n;
if (maximumFeeWei > capWei || balance < capWei) throw new Error("HYPEREVM_CORE_RESUME_CAP_INVALID");
const report = { schemaVersion: 1, chainId: 999, generatedAt: new Date().toISOString(), referenceBlock: block.number.toString(), deployer, pendingNonce: nonce, balanceHype: formatEther(balance), planSha256: plan.planSha256, transactionCount: 7, gasPriceWei: gasPrice.toString(), simulatedGasUsed: simulation.totalGasUsed, aggregateGasLimit: gasLimit.toString(), maximumFeeHype: formatEther(maximumFeeWei), proposedCapHype: "0.0025", confirmedPrefixCodeCount: expectedConfirmed.length, pendingAddressCount: pendingAddresses.length, gates: { simulationPassed: true, nonceMatches: true, confirmedPrefixPresent: true, pendingAddressesEmpty: true, privateKeysRead: false, broadcastAllowed: false, separateApprovalRequired: true } };
await writeFile(path.join(directory, "core-resume-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(report, null, 2));
