import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, encodeDeployData, encodeFunctionData, formatEther, getAddress,
  getContractAddress, http, keccak256, parseEther, type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
type BroadcastRecord = { name: string; nonce: number; hash: Hex; raw?: Hex; state: "signed" | "confirmed"; gasUsed?: string; feeWei?: string };
const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
if ((environment !== "testnet" && environment !== "mainnet") || !process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY || !capArg) {
  throw new Error("PERPS_BROADCAST_CONFIG_INVALID");
}
const capWei = parseEther(capArg);
const expectedCap = environment === "testnet" ? parseEther("0.0007") : parseEther("0.0014");
if (capWei !== expectedCap) throw new Error("PERPS_BROADCAST_CAP_NOT_APPROVED");
const plan = JSON.parse(await readFile(path.join(root, `deployments/${environment}/perps-v1-plan.json`), "utf8")) as any;
const feePlan = JSON.parse(await readFile(path.join(root, `deployments/${environment}/perps-v1-fee-preflight.json`), "utf8")) as any;
if (plan.environment !== environment || plan.chainId !== (environment === "testnet" ? 46630 : 4663) || plan.transactionCount !== 22 || feePlan.transactionCount !== 22) {
  throw new Error("PERPS_BROADCAST_PLAN_INVALID");
}
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== plan.deployer.toLowerCase()) throw new Error("PERPS_DEPLOYER_MISMATCH");
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== plan.chainId) throw new Error("PERPS_CHAIN_MISMATCH");
const artifactRoot = path.join(root, "packages/contracts/out");
const sourceFile = (name: string) => name.startsWith("PrivatePerp") ? "PrivatePerpProofVerifiers" : name;
const artifact = async (name: string): Promise<Artifact> => JSON.parse(await readFile(
  path.join(artifactRoot, `${sourceFile(name)}.sol`, `${name}.json`), "utf8",
));
const names = [
  "OpenGroth16", "CloseGroth16", "ModifyGroth16", "ClaimGroth16",
  "PrivatePerpOpenVerifier", "PrivatePerpCloseVerifier", "PrivatePerpModifyVerifier", "PrivatePerpClaimVerifier",
  "PerpMarketRegistry", "ChainlinkOracleAdapter", "FundingRateModule", "PerpEngine",
  "InsuranceFund", "LiquidityVaultUSDG", "ShieldedPerpAdapter", "ERC1967Proxy",
];
const artifacts = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await artifact(name)])));
const init = (name: string, args: readonly unknown[]) => encodeFunctionData({ abi: artifacts[name].abi, functionName: "initialize", args });
const a = plan.addresses as Record<string, Address>;
const initializer: Record<string, Hex> = {
  PerpMarketRegistry: init("PerpMarketRegistry", [plan.governance.admin, plan.governance.upgrader, plan.governance.admin]),
  ChainlinkOracleAdapter: init("ChainlinkOracleAdapter", [plan.governance.admin, plan.governance.upgrader, plan.governance.admin]),
  FundingRateModule: init("FundingRateModule", [plan.governance.admin, plan.governance.upgrader, plan.governance.admin]),
  PerpEngine: init("PerpEngine", [plan.governance.admin, plan.governance.upgrader, plan.governance.admin, a.LiquidityVaultUSDGProxy, a.PerpMarketRegistryProxy, a.ChainlinkOracleAdapterProxy, a.FundingRateModuleProxy]),
  InsuranceFund: init("InsuranceFund", [plan.governance.admin, plan.governance.upgrader, a.LiquidityVaultUSDGProxy, plan.dependencies.collateral]),
  LiquidityVaultUSDG: init("LiquidityVaultUSDG", [plan.governance.admin, plan.governance.upgrader, plan.governance.admin, plan.dependencies.collateral, a.PerpEngineProxy, a.InsuranceFundProxy, 5_000_000n, 300n, 5_000]),
  ShieldedPerpAdapter: init("ShieldedPerpAdapter", [plan.governance.admin, plan.governance.upgrader, plan.dependencies.collateral, a.LiquidityVaultUSDGProxy, plan.dependencies.privateVaultV2, a.PrivatePerpOpenVerifier, a.PrivatePerpCloseVerifier, a.PrivatePerpModifyVerifier, a.PrivatePerpClaimVerifier]),
};
const wrapperTarget: Record<string, string> = {
  PrivatePerpOpenVerifier: "OpenGroth16", PrivatePerpCloseVerifier: "CloseGroth16",
  PrivatePerpModifyVerifier: "ModifyGroth16", PrivatePerpClaimVerifier: "ClaimGroth16",
};
const dataFor = (step: string): Hex => {
  if (step.endsWith("Proxy")) {
    const base = step.slice(0, -"Proxy".length);
    return encodeDeployData({ abi: artifacts.ERC1967Proxy.abi, bytecode: artifacts.ERC1967Proxy.bytecode.object, args: [a[`${base}Implementation`], initializer[base]] });
  }
  if (step.endsWith("Implementation")) {
    const base = step.slice(0, -"Implementation".length);
    return encodeDeployData({ abi: artifacts[base].abi, bytecode: artifacts[base].bytecode.object });
  }
  const args = wrapperTarget[step] ? [a[wrapperTarget[step]]] : [];
  return encodeDeployData({ abi: artifacts[step].abi, bytecode: artifacts[step].bytecode.object, args });
};
const transactions: Array<{ name: string; nonce: number; data: Hex; address: Address; gas: bigint }> = plan.order.map((name: string, index: number) => ({
  name, nonce: plan.startingNonce + index, data: dataFor(name), address: getAddress(a[name]!),
  gas: BigInt(feePlan.stages[index].estimatedGas),
}));
for (const tx of transactions) {
  if (getContractAddress({ from: account.address, nonce: BigInt(tx.nonce) }) !== tx.address) throw new Error(`PERPS_ADDRESS_MISMATCH_${tx.name}`);
}
const journalPath = path.join(root, `deployments/${environment}/perps-v1-broadcast.private.json`);
await mkdir(path.dirname(journalPath), { recursive: true });
let journal: { capWei: string; transactions: BroadcastRecord[] };
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch { journal = { capWei: capWei.toString(), transactions: [] }; }
if (journal.capWei !== capWei.toString()) throw new Error("PERPS_JOURNAL_CAP_MISMATCH");
const save = () => writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
for (let index = 0; index < transactions.length; index++) {
  const tx = transactions[index]!;
  let record = journal.transactions.find((item) => item.name === tx.name);
  if (record?.state === "signed") {
    try { await client.getTransaction({ hash: record.hash }); }
    catch {
      journal.transactions = journal.transactions.filter((item) => item.name !== tx.name);
      await save();
      record = undefined;
    }
  }
  if (!record) {
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (nonce !== tx.nonce) throw new Error(`PERPS_NONCE_CHANGED_${tx.name}_${nonce}`);
    if (await client.getCode({ address: tx.address })) throw new Error(`PERPS_ADDRESS_OCCUPIED_${tx.name}`);
    const [reportedGasPrice, latestBlock] = await Promise.all([client.getGasPrice(), client.getBlock()]);
    const baseFeeFloor = latestBlock.baseFeePerGas ? (latestBlock.baseFeePerGas * 125n + 99n) / 100n : 0n;
    const gasPrice = reportedGasPrice > baseFeeFloor ? reportedGasPrice : baseFeeFloor;
    const spent = journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei ?? "0"), 0n);
    const remaining = transactions.slice(index).reduce((sum, item) => sum + item.gas * gasPrice, 0n);
    if (spent + remaining > capWei) throw new Error("PERPS_TOTAL_FEE_CAP_EXCEEDED");
    const raw = await account.signTransaction({ chainId: plan.chainId, nonce: tx.nonce, data: tx.data, gas: tx.gas, gasPrice, type: "legacy" });
    record = { name: tx.name, nonce: tx.nonce, hash: keccak256(raw), raw, state: "signed" };
    journal.transactions.push(record); await save();
    const sent = await client.sendRawTransaction({ serializedTransaction: raw });
    if (sent !== record.hash) throw new Error("PERPS_BROADCAST_HASH_MISMATCH");
  }
  const receipt = await client.waitForTransactionReceipt({ hash: record.hash, confirmations: 1, timeout: 120_000, pollingInterval: 1_500 });
  if (receipt.status !== "success" || getAddress(receipt.contractAddress!) !== tx.address) throw new Error(`PERPS_DEPLOYMENT_FAILED_${tx.name}`);
  record.state = "confirmed"; record.gasUsed = receipt.gasUsed.toString(); record.feeWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
  delete (record as any).raw; await save();
}
const totalFee = journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei ?? "0"), 0n);
if (totalFee > capWei) throw new Error("PERPS_ACTUAL_FEE_CAP_EXCEEDED");
for (const tx of transactions) if (!(await client.getCode({ address: tx.address }))) throw new Error(`PERPS_RUNTIME_MISSING_${tx.name}`);
console.log(JSON.stringify({ environment, chainId: plan.chainId, confirmed: journal.transactions.length, totalFeeWei: totalFee.toString(), totalFeeEth: formatEther(totalFee), capEth: capArg, adapter: a.ShieldedPerpAdapterProxy }));
