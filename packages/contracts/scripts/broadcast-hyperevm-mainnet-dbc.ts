import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Tx = { nonce: number; name: string; predictedContractAddress?: Address; to?: Address; data: Hex };
const root = path.resolve(import.meta.dirname, "../../.."), directory = path.join(root, "deployments/hyperevm-mainnet");
const expectedHash = "92c8cddea71f4cf8ecb902119acabd4694e2c948c8b8424b19dfc5ed94fcc09d", capWei = 4_000_000_000_000_000n;
if (!process.argv.includes("--broadcast") || !process.argv.includes(`--approve-plan=${expectedHash}`) || !process.argv.includes("--cap-hype=0.004")) throw new Error("HYPEREVM_DBC_EXPLICIT_APPROVAL_REQUIRED");
if (!process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY) throw new Error("HYPEREVM_DBC_ENV_REQUIRED");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex), deployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
if (getAddress(account.address) !== deployer) throw new Error("HYPEREVM_DBC_SIGNER_INVALID");
const plan = JSON.parse(await readFile(path.join(directory, "dbc-deployment-plan.json"), "utf8")) as { planSha256: string; deployments: Tx[]; configurations: Tx[] };
const simulation = JSON.parse(await readFile(path.join(directory, "dbc-deployment-simulation.json"), "utf8")) as { sourcePlanSha256: string; passed: boolean; receipts: Array<{ nonce: number; gasLimit: string }> };
const acceptance = JSON.parse(await readFile(path.join(directory, "dbc-fork-acceptance.json"), "utf8")) as { sourcePlanSha256: string; passed: boolean };
if (plan.planSha256 !== expectedHash || simulation.sourcePlanSha256 !== expectedHash || acceptance.sourcePlanSha256 !== expectedHash || !simulation.passed || !acceptance.passed) throw new Error("HYPEREVM_DBC_EVIDENCE_INVALID");
const transactions = [...plan.deployments, ...plan.configurations].sort((a, b) => a.nonce - b.nonce); if (transactions.length !== 24 || transactions.some((tx, index) => tx.nonce !== index + 10)) throw new Error("HYPEREVM_DBC_NONCE_SEQUENCE_INVALID");
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }), publicClient = createPublicClient({ transport }), walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== 999) throw new Error("HYPEREVM_DBC_CHAIN_INVALID");
const gasLimits = new Map(simulation.receipts.map((receipt) => [receipt.nonce, BigInt(receipt.gasLimit)]));
const predicted = transactions.flatMap((tx) => tx.predictedContractAddress ? [getAddress(tx.predictedContractAddress)] : []);
const [nonce, balance, gasPrice, codes] = await Promise.all([publicClient.getTransactionCount({ address: deployer, blockTag: "pending" }), publicClient.getBalance({ address: deployer }), publicClient.getGasPrice(), Promise.all(predicted.map((address) => publicClient.getCode({ address })))]);
if (nonce !== 10 || codes.some((code) => code && code !== "0x")) throw new Error("HYPEREVM_DBC_LIVE_STATE_INVALID");
const maximumFeeWei = transactions.reduce((sum, tx) => sum + (gasLimits.get(tx.nonce) ?? 0n) * gasPrice, 0n); if (maximumFeeWei > capWei || balance < capWei) throw new Error("HYPEREVM_DBC_CAP_EXCEEDED");
const journalPath = path.join(directory, "dbc-broadcast.private.json"); const journal: { planSha256: string; startedAt: string; maximumFeeHype: string; transactions: Array<Record<string, unknown>> } = { planSha256: expectedHash, startedAt: new Date().toISOString(), maximumFeeHype: formatEther(maximumFeeWei), transactions: [] };
await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
for (const tx of transactions) { const gas = gasLimits.get(tx.nonce); if (!gas || gas > 3_000_000n) throw new Error(`HYPEREVM_DBC_GAS_INVALID:${tx.nonce}`); const hash = await walletClient.sendTransaction({ account, chain: null, ...(tx.to ? { to: getAddress(tx.to) } : {}), data: tx.data, gas, gasPrice, nonce: tx.nonce }); journal.transactions.push({ nonce: tx.nonce, name: tx.name, hash, state: "submitted" }); await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 }); const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); if (receipt.status !== "success") throw new Error(`HYPEREVM_DBC_REVERTED:${tx.nonce}`); if (tx.predictedContractAddress && getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !== getAddress(tx.predictedContractAddress)) throw new Error(`HYPEREVM_DBC_ADDRESS_MISMATCH:${tx.nonce}`); journal.transactions[journal.transactions.length - 1] = { nonce: tx.nonce, name: tx.name, hash, state: "confirmed", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress }; await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 }); }
const fee = journal.transactions.reduce((sum, tx) => sum + BigInt(String(tx.gasUsed)) * BigInt(String(tx.effectiveGasPrice)), 0n); if (fee > capWei) throw new Error("HYPEREVM_DBC_ACTUAL_FEE_EXCEEDED"); console.log(JSON.stringify({ confirmedTransactions: journal.transactions.length, nextNonce: 34, totalFeeHype: formatEther(fee), journal: "deployments/hyperevm-mainnet/dbc-broadcast.private.json" }, null, 2));
