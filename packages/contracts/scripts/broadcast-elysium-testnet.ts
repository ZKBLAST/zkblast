import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type PlannedTransaction = Readonly<{
  nonce: number;
  name?: string;
  description?: string;
  predictedContractAddress?: Address;
  target?: Address;
  to?: Address;
  data: Hex;
}>;
type SimulationReceipt = Readonly<{
  nonce: number;
  estimatedGas: string;
  gasLimit?: string;
}>;
type Plan = Readonly<{
  planSha256: string;
  deployments: PlannedTransaction[];
  configurations?: PlannedTransaction[];
  governanceCalls?: PlannedTransaction[];
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const deploymentDirectory = path.join(root, "deployments/elysium-testnet");
const privateReceiptDirectory = path.join(
  deploymentDirectory,
  "receipts-private",
);
const readJson = async <T>(relativePath: string): Promise<T> =>
  JSON.parse(
    await readFile(path.join(deploymentDirectory, relativePath), "utf8"),
  ) as T;
const argument = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const approvedCandidate = argument("candidate");
const maximumSpendHype = argument("cap-hype");
if (!approvedCandidate || !/^[0-9a-f]{64}$/u.test(approvedCandidate)) {
  throw new Error("ELYSIUM_APPROVED_CANDIDATE_REQUIRED");
}
if (!maximumSpendHype || !/^\d+(?:\.\d{1,18})?$/u.test(maximumSpendHype)) {
  throw new Error("ELYSIUM_MAXIMUM_SPEND_REQUIRED");
}

const candidate = await readJson<{
  chainId: number;
  deployer: Address;
  startingNonce: number;
  nextNonce: number;
  transactionCount: number;
  candidateSha256: string;
  plans: {
    dbc: { sha256: string };
    launchpad: { sha256: string };
    protectedLaunch: { sha256: string };
  };
  gates: { broadcastAllowed: boolean };
}>("manifest-candidate.json");
if (
  candidate.chainId !== 99_801 ||
  candidate.startingNonce !== 0 ||
  candidate.nextNonce !== 63 ||
  candidate.transactionCount !== 63 ||
  candidate.gates.broadcastAllowed ||
  candidate.candidateSha256 !== approvedCandidate
) {
  throw new Error("ELYSIUM_BROADCAST_CANDIDATE_INVALID");
}

const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
if (!privateKey || !/^0x[0-9a-f]{64}$/iu.test(privateKey)) {
  throw new Error("ELYSIUM_DEPLOYER_PRIVATE_KEY_REQUIRED");
}
const account = privateKeyToAccount(privateKey as Hex);
if (getAddress(account.address) !== getAddress(candidate.deployer)) {
  throw new Error("ELYSIUM_DEPLOYER_PRIVATE_KEY_MISMATCH");
}

const rpcUrl =
  process.env.ELYSIUM_PRIVATE_RPC_URL?.trim() ||
  "https://testnet-rpc.elysium.kinetiq.xyz";
const transport = http(rpcUrl, {
  retryCount: 5,
  retryDelay: 750,
  timeout: 30_000,
});
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account, transport });
if (await publicClient.getChainId() !== candidate.chainId) {
  throw new Error("ELYSIUM_BROADCAST_CHAIN_MISMATCH");
}

const [dbc, launchpad, protectedLaunch] = await Promise.all([
  readJson<Plan>("dbc-deployment-plan.json"),
  readJson<Plan>("launchpad-deployment-plan.json"),
  readJson<Plan>("protected-launch/deployment-plan.json"),
]);
if (
  dbc.planSha256 !== candidate.plans.dbc.sha256 ||
  launchpad.planSha256 !== candidate.plans.launchpad.sha256 ||
  protectedLaunch.planSha256 !== candidate.plans.protectedLaunch.sha256
) {
  throw new Error("ELYSIUM_BROADCAST_PLAN_HASH_MISMATCH");
}

const preflight = await readJson<{
  governancePlan: {
    predictedTimelock: Address;
    minimumDelaySeconds: string;
  };
  roles: { governance: Address };
}>("preflight.json");
const timelockArtifact = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/contracts/out-elysium/ZKBlastTimelock.sol/ZKBlastTimelock.json",
    ),
    "utf8",
  ),
) as { abi: readonly unknown[]; bytecode: { object: Hex } };
const timelockData = encodeDeployData({
  abi: timelockArtifact.abi,
  bytecode: timelockArtifact.bytecode.object,
  args: [
    BigInt(preflight.governancePlan.minimumDelaySeconds),
    getAddress(preflight.roles.governance),
  ],
});
const transactions: PlannedTransaction[] = [
  {
    nonce: 0,
    name: "governanceTimelock",
    predictedContractAddress: preflight.governancePlan.predictedTimelock,
    data: timelockData,
  },
  ...dbc.deployments,
  ...(dbc.configurations ?? []),
  ...launchpad.deployments,
  ...(launchpad.configurations ?? []),
  ...protectedLaunch.deployments,
  ...(protectedLaunch.governanceCalls ?? protectedLaunch.configurations ?? []),
].sort((left, right) => left.nonce - right.nonce);
if (
  transactions.length !== 63 ||
  transactions.some((transaction, index) => transaction.nonce !== index)
) {
  throw new Error("ELYSIUM_BROADCAST_NONCE_SEQUENCE_INVALID");
}

const [timelockSimulation, dbcSimulation, launchpadSimulation, protectedSimulation] =
  await Promise.all([
    readJson<{ nonce: number; gasLimit: string; passed: boolean }>(
      "timelock-deployment-simulation.json",
    ),
    readJson<{ receipts: SimulationReceipt[]; passed: boolean }>(
      "dbc-deployment-simulation.json",
    ),
    readJson<{ receipts: SimulationReceipt[]; passed: boolean }>(
      "launchpad-deployment-simulation.json",
    ),
    readJson<{ receipts: SimulationReceipt[]; passed: boolean }>(
      "protected-launch/deployment-simulation.json",
    ),
  ]);
if (
  !timelockSimulation.passed ||
  !dbcSimulation.passed ||
  !launchpadSimulation.passed ||
  !protectedSimulation.passed
) {
  throw new Error("ELYSIUM_BROADCAST_SIMULATION_REQUIRED");
}
const gasByNonce = new Map<number, bigint>([
  [timelockSimulation.nonce, BigInt(timelockSimulation.gasLimit)],
  ...dbcSimulation.receipts.map((receipt) => [
    receipt.nonce,
    receipt.gasLimit ? BigInt(receipt.gasLimit) : BigInt(receipt.estimatedGas) + 100_000n,
  ] as const),
  ...launchpadSimulation.receipts.map((receipt) => [
    receipt.nonce,
    receipt.gasLimit ? BigInt(receipt.gasLimit) : BigInt(receipt.estimatedGas) + 100_000n,
  ] as const),
  ...protectedSimulation.receipts.map((receipt) => [
    receipt.nonce,
    receipt.gasLimit ? BigInt(receipt.gasLimit) : BigInt(receipt.estimatedGas) + 100_000n,
  ] as const),
]);
if (gasByNonce.size !== transactions.length) {
  throw new Error("ELYSIUM_BROADCAST_GAS_PLAN_INCOMPLETE");
}

await mkdir(privateReceiptDirectory, { recursive: true, mode: 0o700 });
const journalPath = path.join(
  privateReceiptDirectory,
  `${candidate.candidateSha256}.json`,
);
type JournalTransaction = Record<string, unknown> & {
  nonce: number;
  hash?: Hex;
  state: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
};
type BroadcastJournal = {
  schemaVersion: number;
  chainId: number;
  candidateSha256: string;
  approvedCapHype: string;
  referenceBlock: string;
  gasPriceWei: string;
  transactions: JournalTransaction[];
};

const [pendingNonce, balance, referenceGasPrice, block] = await Promise.all([
  publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  publicClient.getBalance({ address: account.address }),
  publicClient.getGasPrice(),
  publicClient.getBlock(),
]);
if (pendingNonce < 0 || pendingNonce > transactions.length) {
  throw new Error(`ELYSIUM_BROADCAST_NONCE_INVALID:${pendingNonce}`);
}

let journal: BroadcastJournal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8")) as BroadcastJournal;
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") throw error;
  journal = {
    schemaVersion: 1,
    chainId: candidate.chainId,
    candidateSha256: candidate.candidateSha256,
    approvedCapHype: maximumSpendHype,
    referenceBlock: block.number.toString(),
    gasPriceWei: referenceGasPrice.toString(),
    transactions: [],
  };
}
if (
  journal.chainId !== candidate.chainId ||
  journal.candidateSha256 !== candidate.candidateSha256 ||
  journal.approvedCapHype !== maximumSpendHype
) {
  throw new Error("ELYSIUM_BROADCAST_JOURNAL_MISMATCH");
}

const confirmedByNonce = new Map(
  journal.transactions
    .filter((transaction) => transaction.state === "confirmed")
    .map((transaction) => [transaction.nonce, transaction] as const),
);
for (let nonce = 0; nonce < pendingNonce; nonce += 1) {
  const recorded = confirmedByNonce.get(nonce);
  if (!recorded?.hash) {
    throw new Error(`ELYSIUM_BROADCAST_JOURNAL_GAP:${nonce}`);
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: recorded.hash });
  if (receipt.status !== "success") {
    throw new Error(`ELYSIUM_BROADCAST_PRIOR_TRANSACTION_FAILED:${nonce}`);
  }
  const planned = transactions[nonce]!;
  if (
    planned.predictedContractAddress &&
    getAddress(
      receipt.contractAddress ?? "0x0000000000000000000000000000000000000000",
    ) !== getAddress(planned.predictedContractAddress)
  ) {
    throw new Error(`ELYSIUM_BROADCAST_PRIOR_ADDRESS_MISMATCH:${nonce}`);
  }
}

for (const transaction of transactions) {
  if (!transaction.predictedContractAddress) continue;
  let code: Hex | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      code = await publicClient.getCode({
        address: transaction.predictedContractAddress,
      });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
    }
  }
  const occupied = Boolean(code && code !== "0x");
  if (transaction.nonce < pendingNonce ? !occupied : occupied) {
    throw new Error(
      `ELYSIUM_BROADCAST_PREDICTED_ADDRESS_STATE_INVALID:${transaction.nonce}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const approvedCapWei = parseEther(maximumSpendHype);
const alreadySpentWei = journal.transactions.reduce(
  (total, transaction) =>
    total +
    BigInt(transaction.gasUsed ?? "0") *
      BigInt(transaction.effectiveGasPrice ?? "0"),
  0n,
);
if (alreadySpentWei > approvedCapWei) {
  throw new Error(`ELYSIUM_BROADCAST_CAP_ALREADY_EXCEEDED:${formatEther(alreadySpentWei)}`);
}
if (balance + alreadySpentWei < approvedCapWei) {
  throw new Error(`ELYSIUM_BROADCAST_BALANCE_INSUFFICIENT:${formatEther(balance)}`);
}
await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
  mode: 0o600,
});

for (const transaction of transactions.slice(pendingNonce)) {
  const gas = gasByNonce.get(transaction.nonce);
  if (!gas) throw new Error(`ELYSIUM_BROADCAST_GAS_MISSING:${transaction.nonce}`);
  const liveGasPrice = await publicClient.getGasPrice();
  const transactionGasPrice = (liveGasPrice * 105n + 99n) / 100n;
  const spentWei = journal.transactions.reduce(
    (total, recorded) =>
      total +
      BigInt(recorded.gasUsed ?? "0") *
        BigInt(recorded.effectiveGasPrice ?? "0"),
    0n,
  );
  const remainingGasLimit = transactions
    .slice(transaction.nonce)
    .reduce((total, planned) => {
      const plannedGas = gasByNonce.get(planned.nonce);
      if (!plannedGas) throw new Error(`ELYSIUM_BROADCAST_GAS_MISSING:${planned.nonce}`);
      return total + plannedGas;
    }, 0n);
  const conservativeMaximumWei = spentWei + remainingGasLimit * transactionGasPrice;
  if (conservativeMaximumWei > approvedCapWei) {
    throw new Error(
      `ELYSIUM_BROADCAST_CAP_EXCEEDED_BEFORE_SIGNING:${transaction.nonce}:${formatEther(conservativeMaximumWei)}`,
    );
  }
  const target = transaction.to ?? transaction.target;
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    ...(target ? { to: getAddress(target) } : {}),
    data: transaction.data,
    gas,
    gasPrice: transactionGasPrice,
    nonce: transaction.nonce,
  });
  journal.transactions.push({
    nonce: transaction.nonce,
    name: transaction.name ?? transaction.description,
    hash,
    state: "submitted",
  });
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`ELYSIUM_BROADCAST_REVERTED:${transaction.nonce}:${hash}`);
  }
  if (
    transaction.predictedContractAddress &&
    getAddress(
      receipt.contractAddress ?? "0x0000000000000000000000000000000000000000",
    ) !== getAddress(transaction.predictedContractAddress)
  ) {
    throw new Error(`ELYSIUM_BROADCAST_ADDRESS_MISMATCH:${transaction.nonce}`);
  }
  journal.transactions[journal.transactions.length - 1] = {
    nonce: transaction.nonce,
    name: transaction.name ?? transaction.description,
    hash,
    state: "confirmed",
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
  };
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      nonce: transaction.nonce,
      name: transaction.name ?? transaction.description,
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const gasUsed = journal.transactions.reduce(
  (total, transaction) => total + BigInt(String(transaction.gasUsed ?? "0")),
  0n,
);
const totalFeeWei = journal.transactions.reduce(
  (total, transaction) =>
    total +
    BigInt(transaction.gasUsed ?? "0") *
      BigInt(transaction.effectiveGasPrice ?? "0"),
  0n,
);
console.log(
  JSON.stringify(
    {
      chainId: candidate.chainId,
      candidateSha256: candidate.candidateSha256,
      transactionCount: journal.transactions.length,
      gasUsed: gasUsed.toString(),
      totalFeeHype: formatEther(totalFeeWei),
      approvedCapHype: maximumSpendHype,
      completed: true,
    },
    null,
    2,
  ),
);
