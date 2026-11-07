import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatEther, zeroAddress } from "viem";

type Json = Record<string, unknown>;
type JournalTransaction = {
  nonce: number;
  name?: string;
  hash: string;
  state: string;
  blockNumber: string;
  blockHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
  contractAddress?: string | null;
};

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const candidate = JSON.parse(
  await readFile(path.join(directory, "manifest-candidate.json"), "utf8"),
) as Json & {
  candidateSha256: string;
  chainId: number;
  environment: string;
  deployer: string;
  governance: Json;
  plans: Json;
  capabilities: Json;
};
const verification = JSON.parse(
  await readFile(
    path.join(directory, "local-post-deployment-verification.json"),
    "utf8",
  ),
) as Json & { passed: boolean; nextNonce: number; proxyChecks: Json[] };
const journal = JSON.parse(
  await readFile(
    path.join(
      directory,
      "receipts-private",
      `${candidate.candidateSha256}.json`,
    ),
    "utf8",
  ),
) as {
  approvedCapHype: string;
  transactions: JournalTransaction[];
};

if (
  !verification.passed ||
  verification.nextNonce !== 63 ||
  journal.transactions.length !== 63 ||
  journal.transactions.some(
    (transaction, nonce) =>
      transaction.nonce !== nonce || transaction.state !== "confirmed",
  )
) {
  throw new Error("ELYSIUM_MANIFEST_FINALIZATION_GATES_FAILED");
}

const explorerBaseUrl = "https://elysium.kinetiq.xyz/testnet-explorer";
const transactionAt = (nonce: number) => {
  const transaction = journal.transactions[nonce];
  if (!transaction || transaction.nonce !== nonce)
    throw new Error(`ELYSIUM_MANIFEST_TRANSACTION_MISSING:${nonce}`);
  return transaction;
};
const dbcAddresses = (candidate.plans.dbc as { addresses: Record<string, string> }).addresses;
const launchpadAddresses = (candidate.plans.launchpad as { addresses: Record<string, string> }).addresses;
const protectedAddresses = (candidate.plans.protectedLaunch as { addresses: Record<string, string> }).addresses;
const address = (values: Record<string, string>, key: string) => {
  const value = values[key];
  if (!value) throw new Error(`ELYSIUM_MANIFEST_ADDRESS_MISSING:${key}`);
  return value;
};
const totalGasUsed = journal.transactions.reduce(
  (total, transaction) => total + BigInt(transaction.gasUsed),
  0n,
);
const totalFeeWei = journal.transactions.reduce(
  (total, transaction) =>
    total +
    BigInt(transaction.gasUsed) * BigInt(transaction.effectiveGasPrice),
  0n,
);
const manifest = {
  schemaVersion: 2,
  protocol: "ZKBLAST",
  kind: "elysium-testnet-deployment",
  generatedAt: new Date().toISOString(),
  environment: "testnet",
  chainId: candidate.chainId,
  chainName: "Elysium Testnet",
  deploymentBlock: Number(transactionAt(0).blockNumber),
  deploymentBlockHash: transactionAt(0).blockHash,
  deployerAddress: candidate.deployer,
  governanceAddress: candidate.deployer,
  upgraderAddress: (candidate.governance as { timelock: string }).timelock,
  contracts: {},
  roles: {
    defaultAdmin: candidate.deployer,
    upgrader: (candidate.governance as { timelock: string }).timelock,
    factory: address(dbcAddresses, "launchFactory"),
  },
  totals: {
    transactionCount: journal.transactions.length,
    gasUsed: totalGasUsed.toString(),
    totalFeeWei: totalFeeWei.toString(),
  },
  integration: {
    poolRegistry: zeroAddress,
    poolFactory: zeroAddress,
    swapRouter: zeroAddress,
    positionManager: zeroAddress,
    poolQuoter: zeroAddress,
  },
  dbc: {
    abiVersion: 1,
    deploymentBlock: Number(transactionAt(1).blockNumber),
    configRegistry: address(dbcAddresses, "configRegistry"),
    launchTokenDeployer: address(dbcAddresses, "launchTokenDeployer"),
    virtualPoolDeployer: address(dbcAddresses, "virtualPoolDeployer"),
    launchFactory: address(dbcAddresses, "launchFactory"),
    curveQuoter: address(dbcAddresses, "curveQuoter"),
    launchpadRouter: address(dbcAddresses, "launchpadRouter"),
    graduationManager: address(dbcAddresses, "graduationManager"),
    dammGraduationAdapter: zeroAddress,
    lpAllocationEscrow: address(dbcAddresses, "lpAllocationEscrow"),
  },
  launchpad: {
    abiVersion: 1,
    deploymentBlock: Number(transactionAt(22).blockNumber),
    registry: address(launchpadAddresses, "registry"),
    configManager: address(launchpadAddresses, "configManager"),
    factory: address(launchpadAddresses, "factory"),
    lens: address(launchpadAddresses, "lens"),
    feeController: address(launchpadAddresses, "feeController"),
    revenueSplitter: address(launchpadAddresses, "revenueSplitter"),
    feeCollector: address(launchpadAddresses, "feeCollector"),
    tokenFactory: address(launchpadAddresses, "tokenFactory"),
  },
  protectedLaunch: {
    abiVersion: 1,
    deploymentBlock: Number(transactionAt(43).blockNumber),
    policyRegistry: address(protectedAddresses, "policyRegistry"),
    launchFactory: address(protectedAddresses, "factory"),
    launchRouter: address(protectedAddresses, "router"),
    tokenDeployer: address(protectedAddresses, "tokenDeployer"),
    virtualPoolDeployer: address(protectedAddresses, "virtualPoolDeployer"),
    lpEscrow: address(protectedAddresses, "lpEscrow"),
    graduationManager: address(protectedAddresses, "graduationManager"),
    dammGraduationAdapter: zeroAddress,
    identityRegistry: address(protectedAddresses, "identityRegistry"),
  },
  chain: {
    chainId: candidate.chainId,
    name: "Elysium Testnet",
    environment: candidate.environment,
    explorerUrl: explorerBaseUrl,
  },
  candidateSha256: candidate.candidateSha256,
  deployer: candidate.deployer,
  governance: candidate.governance,
  plans: candidate.plans,
  proxyChecks: verification.proxyChecks,
  transactions: journal.transactions.map((transaction) => ({
    nonce: transaction.nonce,
    name: transaction.name,
    hash: transaction.hash,
    explorerUrl: `${explorerBaseUrl}/tx/${transaction.hash}`,
    blockNumber: transaction.blockNumber,
    blockHash: transaction.blockHash,
    gasUsed: transaction.gasUsed,
    effectiveGasPrice: transaction.effectiveGasPrice,
    contractAddress: transaction.contractAddress ?? null,
  })),
  gas: {
    transactionCount: journal.transactions.length,
    totalGasUsed: totalGasUsed.toString(),
    totalFeeWei: totalFeeWei.toString(),
    totalFeeHype: formatEther(totalFeeWei),
    approvedCapHype: journal.approvedCapHype,
  },
  capabilities: {
    ...candidate.capabilities,
    publicDeployment: true,
  },
  verification: {
    passed: true,
    codeChecks: (verification.codeChecks as unknown[]).length,
    proxyChecks: verification.proxyChecks.length,
    nextNonce: verification.nextNonce,
  },
};

await writeFile(
  path.join(directory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(
  JSON.stringify(
    {
      manifest: "deployments/elysium-testnet/manifest.json",
      transactionCount: journal.transactions.length,
      totalGasUsed: totalGasUsed.toString(),
      totalFeeWei: totalFeeWei.toString(),
      verificationPassed: true,
    },
    null,
    2,
  ),
);
