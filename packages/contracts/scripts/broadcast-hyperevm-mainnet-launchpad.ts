import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Deployment = {
  nonce: number;
  name: string;
  predictedContractAddress: Address;
  data: Hex;
};
type Configuration = {
  nonce: number;
  description: string;
  target: Address;
  data: Hex;
};
type PlannedTransaction = {
  nonce: number;
  name: string;
  predictedContractAddress?: Address;
  to?: Address;
  data: Hex;
};

const expectedHash = "019f3384052efb77427ade4692eb53ca2bead70be0973c9b623d28dfede0cac4";
const capWei = 3_000_000_000_000_000n;
const expectedDeployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");

if (
  !process.argv.includes("--broadcast") ||
  !process.argv.includes(`--approve-plan=${expectedHash}`) ||
  !process.argv.includes("--cap-hype=0.003")
) throw new Error("HYPEREVM_LAUNCHPAD_EXPLICIT_APPROVAL_REQUIRED");
if (!process.env.RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error("HYPEREVM_LAUNCHPAD_ENV_REQUIRED");
}

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
if (getAddress(account.address) !== expectedDeployer) throw new Error("HYPEREVM_LAUNCHPAD_SIGNER_INVALID");

const plan = JSON.parse(await readFile(path.join(directory, "launchpad-deployment-plan.json"), "utf8")) as {
  chainId: number;
  deployer: Address;
  planSha256: string;
  startingNonce: number;
  nextNonce: number;
  transactionCount: number;
  deployments: Deployment[];
  configurations: Configuration[];
};
const simulation = JSON.parse(await readFile(path.join(directory, "launchpad-deployment-simulation.json"), "utf8")) as {
  sourcePlanSha256: string;
  passed: boolean;
  transactionCount: number;
  receipts: Array<{ nonce: number; gasLimit: string }>;
};
if (
  plan.planSha256 !== expectedHash || simulation.sourcePlanSha256 !== expectedHash || !simulation.passed ||
  plan.chainId !== 999 || getAddress(plan.deployer) !== expectedDeployer ||
  plan.startingNonce !== 34 || plan.nextNonce !== 55 || plan.transactionCount !== 21 ||
  simulation.transactionCount !== 21
) throw new Error("HYPEREVM_LAUNCHPAD_EVIDENCE_INVALID");

const transactions: PlannedTransaction[] = [
  ...plan.deployments.map((tx) => ({ ...tx })),
  ...plan.configurations.map((tx) => ({ nonce: tx.nonce, name: tx.description, to: tx.target, data: tx.data })),
].sort((a, b) => a.nonce - b.nonce);
if (transactions.length !== 21 || transactions.some((tx, index) => tx.nonce !== 34 + index)) {
  throw new Error("HYPEREVM_LAUNCHPAD_NONCE_SEQUENCE_INVALID");
}

const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== 999) throw new Error("HYPEREVM_LAUNCHPAD_CHAIN_INVALID");

const gasLimits = new Map(simulation.receipts.map((receipt) => [receipt.nonce, BigInt(receipt.gasLimit)]));
const predictedAddresses = plan.deployments.map((tx) => getAddress(tx.predictedContractAddress));
const [nonce, balance, gasPrice, codes] = await Promise.all([
  publicClient.getTransactionCount({ address: expectedDeployer, blockTag: "pending" }),
  publicClient.getBalance({ address: expectedDeployer }),
  publicClient.getGasPrice(),
  Promise.all(predictedAddresses.map((address) => publicClient.getCode({ address }))),
]);
if (nonce !== 34 || codes.some((code) => code && code !== "0x")) {
  throw new Error("HYPEREVM_LAUNCHPAD_LIVE_STATE_INVALID");
}
const maximumFeeWei = transactions.reduce((sum, tx) => {
  const gas = gasLimits.get(tx.nonce);
  if (!gas || gas > 3_000_000n) throw new Error(`HYPEREVM_LAUNCHPAD_GAS_INVALID:${tx.nonce}`);
  return sum + gas * gasPrice;
}, 0n);
if (maximumFeeWei > capWei || balance < capWei) throw new Error("HYPEREVM_LAUNCHPAD_CAP_EXCEEDED");

const journalPath = path.join(directory, "launchpad-broadcast.private.json");
const journal: {
  planSha256: string;
  startedAt: string;
  maximumFeeHype: string;
  transactions: Array<Record<string, unknown>>;
} = {
  planSha256: expectedHash,
  startedAt: new Date().toISOString(),
  maximumFeeHype: formatEther(maximumFeeWei),
  transactions: [],
};
const saveJournal = () => writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
await saveJournal();

for (const tx of transactions) {
  const gas = gasLimits.get(tx.nonce)!;
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    ...(tx.to ? { to: getAddress(tx.to) } : {}),
    data: tx.data,
    gas,
    gasPrice,
    nonce: tx.nonce,
  });
  journal.transactions.push({ nonce: tx.nonce, name: tx.name, hash, state: "submitted" });
  await saveJournal();
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`HYPEREVM_LAUNCHPAD_REVERTED:${tx.nonce}`);
  if (
    tx.predictedContractAddress &&
    getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !==
      getAddress(tx.predictedContractAddress)
  ) throw new Error(`HYPEREVM_LAUNCHPAD_ADDRESS_MISMATCH:${tx.nonce}`);
  journal.transactions[journal.transactions.length - 1] = {
    nonce: tx.nonce,
    name: tx.name,
    hash,
    state: "confirmed",
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
  };
  await saveJournal();
}

const totalFeeWei = journal.transactions.reduce(
  (sum, tx) => sum + BigInt(String(tx.gasUsed)) * BigInt(String(tx.effectiveGasPrice)), 0n,
);
if (totalFeeWei > capWei) throw new Error("HYPEREVM_LAUNCHPAD_ACTUAL_FEE_EXCEEDED");
console.log(JSON.stringify({
  confirmedTransactions: journal.transactions.length,
  nextNonce: 55,
  totalFeeHype: formatEther(totalFeeWei),
  journal: "deployments/hyperevm-mainnet/launchpad-broadcast.private.json",
}, null, 2));
