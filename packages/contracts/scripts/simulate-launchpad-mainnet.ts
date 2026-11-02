import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { anvil } from "viem/chains";

type PlannedTransaction = Readonly<{
  name: string;
  signer: Address;
  nonce: number;
  predictedContractAddress: Address;
  calldata: Hex;
  calldataHash: Hex;
}>;

type GovernedTransaction = Readonly<{
  signer: Address;
  safeNonce: string;
  target: Address;
  description: string;
  calldata: Hex;
  calldataHash: Hex;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/launchpad-v1-plan.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  chainId: number;
  referenceBlock: string;
  deployer: Address;
  startingNonce: number;
  deploymentTransactions: PlannedTransaction[];
  governedTransactions: GovernedTransaction[];
  addresses: Record<string, Address>;
  dependencies: {
    dbcConfigRegistry: Address;
    dbcLaunchFactory: Address;
    liveCodeHashes: { dbcConfigRegistry: Hex; dbcLaunchFactory: Hex };
  };
  governance: { admin: Address; safeNonce: string };
  authorization: { broadcastAllowed: boolean };
};
if (plan.chainId !== 4663 || plan.authorization.broadcastAllowed) {
  throw new Error("LAUNCHPAD_SIMULATION_PLAN_INVALID");
}

const rpc = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
const transport = http(rpc, { timeout: 30_000, retryCount: 0 });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ chain: anvil, mode: "anvil", transport });
if ((await publicClient.getChainId()) !== 4663) {
  throw new Error("LAUNCHPAD_SIMULATION_CHAIN_INVALID");
}
const legacyFactoryAbi = parseAbi(["function launchCount() view returns (uint256)"]);
const legacyRegistryAbi = parseAbi(["function templateCount() view returns (uint256)"]);
const legacyBefore = {
  launchCount: await publicClient.readContract({ address: getAddress(plan.dependencies.dbcLaunchFactory), abi: legacyFactoryAbi, functionName: "launchCount" }),
  templateCount: await publicClient.readContract({ address: getAddress(plan.dependencies.dbcConfigRegistry), abi: legacyRegistryAbi, functionName: "templateCount" }),
};

const deployer = getAddress(plan.deployer);
const governance = getAddress(plan.governance.admin);
await Promise.all([
  testClient.setBalance({ address: deployer, value: 10n ** 18n }),
  testClient.setBalance({ address: governance, value: 10n ** 18n }),
]);
await testClient.impersonateAccount({ address: deployer });
const deployerWallet = createWalletClient({ account: deployer, transport });
const deploymentReceipts = [];
let deploymentGas = 0n;
for (const transaction of plan.deploymentTransactions) {
  const nonce = await publicClient.getTransactionCount({ address: deployer, blockTag: "pending" });
  if (nonce !== transaction.nonce) throw new Error(`LAUNCHPAD_NONCE_DRIFT_${transaction.name}`);
  if (keccak256(transaction.calldata) !== transaction.calldataHash) {
    throw new Error(`LAUNCHPAD_CALLDATA_DRIFT_${transaction.name}`);
  }
  const hash = await deployerWallet.sendTransaction({
    account: deployer,
    chain: null,
    data: transaction.calldata,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (
    receipt.status !== "success"
      || !receipt.contractAddress
      || getAddress(receipt.contractAddress) !== getAddress(transaction.predictedContractAddress)
  ) {
    throw new Error(`LAUNCHPAD_DEPLOYMENT_FAILED_${transaction.name}`);
  }
  deploymentGas += receipt.gasUsed;
  deploymentReceipts.push({
    name: transaction.name,
    nonce: transaction.nonce,
    hash,
    contractAddress: receipt.contractAddress,
    gasUsed: receipt.gasUsed.toString(),
  });
}

await testClient.stopImpersonatingAccount({ address: deployer });
await testClient.impersonateAccount({ address: governance });
const governanceWallet = createWalletClient({ account: governance, transport });
const configurationReceipts = [];
let configurationGas = 0n;
for (const transaction of plan.governedTransactions) {
  if (keccak256(transaction.calldata) !== transaction.calldataHash) {
    throw new Error(`LAUNCHPAD_GOVERNED_CALLDATA_DRIFT_${transaction.description}`);
  }
  const hash = await governanceWallet.sendTransaction({
    account: governance,
    chain: null,
    to: getAddress(transaction.target),
    data: transaction.calldata,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`LAUNCHPAD_CONFIGURATION_FAILED_${transaction.description}`);
  }
  configurationGas += receipt.gasUsed;
  configurationReceipts.push({
    description: transaction.description,
    safeNonce: transaction.safeNonce,
    hash,
    gasUsed: receipt.gasUsed.toString(),
  });
}
await testClient.stopImpersonatingAccount({ address: governance });

const accessAbi = parseAbi(["function hasRole(bytes32,address) view returns (bool)"]);
const factoryRole = keccak256(new TextEncoder().encode("ZKBLAST_FACTORY_ROLE"));
const accrualRole = keccak256(new TextEncoder().encode("ZKBLAST_LAUNCHPAD_FEE_ACCRUAL_ROLE"));
const dbcLaunchpadFactoryRole = keccak256(new TextEncoder().encode("ZKBLAST_DBC_LAUNCHPAD_FACTORY_ROLE"));
const plannedAddress = (name: string): Address => {
  const value = plan.addresses[name];
  if (!value) throw new Error(`LAUNCHPAD_PLANNED_ADDRESS_MISSING_${name}`);
  return getAddress(value);
};
const roleChecks = {
  configFactory: await publicClient.readContract({ address: plannedAddress("configManager"), abi: accessAbi, functionName: "hasRole", args: [factoryRole, plannedAddress("factory")] }),
  feeControllerFactory: await publicClient.readContract({ address: plannedAddress("feeController"), abi: accessAbi, functionName: "hasRole", args: [factoryRole, plannedAddress("tokenFactory")] }),
  revenueFactory: await publicClient.readContract({ address: plannedAddress("revenueSplitter"), abi: accessAbi, functionName: "hasRole", args: [factoryRole, plannedAddress("tokenFactory")] }),
  collectorFactory: await publicClient.readContract({ address: plannedAddress("feeCollector"), abi: accessAbi, functionName: "hasRole", args: [factoryRole, plannedAddress("tokenFactory")] }),
  collectorAccrual: await publicClient.readContract({ address: plannedAddress("revenueSplitter"), abi: accessAbi, functionName: "hasRole", args: [accrualRole, plannedAddress("feeCollector")] }),
  dbcTokenFactory: await publicClient.readContract({ address: getAddress(plan.dependencies.dbcLaunchFactory), abi: accessAbi, functionName: "hasRole", args: [dbcLaunchpadFactoryRole, plannedAddress("tokenFactory")] }),
};
if (Object.values(roleChecks).some((value) => !value)) throw new Error("LAUNCHPAD_ROLE_CHECK_FAILED");
const dbcRuntime = await publicClient.getCode({ address: getAddress(plan.dependencies.dbcLaunchFactory) });
const dbcRegistryRuntime = await publicClient.getCode({ address: getAddress(plan.dependencies.dbcConfigRegistry) });
const legacyAfter = {
  launchCount: await publicClient.readContract({ address: getAddress(plan.dependencies.dbcLaunchFactory), abi: legacyFactoryAbi, functionName: "launchCount" }),
  templateCount: await publicClient.readContract({ address: getAddress(plan.dependencies.dbcConfigRegistry), abi: legacyRegistryAbi, functionName: "templateCount" }),
};
if (
  !dbcRuntime
    || !dbcRegistryRuntime
    || keccak256(dbcRuntime) !== plan.dependencies.liveCodeHashes.dbcLaunchFactory
    || keccak256(dbcRegistryRuntime) !== plan.dependencies.liveCodeHashes.dbcConfigRegistry
    || legacyBefore.launchCount !== legacyAfter.launchCount
    || legacyBefore.templateCount !== legacyAfter.templateCount
) {
  throw new Error("LAUNCHPAD_LEGACY_DBC_RUNTIME_CHANGED");
}

const totalGas = deploymentGas + configurationGas;
const result = {
  schemaVersion: 1,
  environment: "mainnet-fork",
  sourceChainId: 4663,
  sourceBlock: plan.referenceBlock,
  simulatedAt: new Date().toISOString(),
  deploymentReceipts,
  configurationReceipts,
  roleChecks,
  gas: {
    deployment: deploymentGas.toString(),
    configuration: configurationGas.toString(),
    total: totalGas.toString(),
    recommendedGasLimitWith20PercentBuffer: ((totalGas * 120n + 99n) / 100n).toString(),
  },
  legacyCompatibility: {
    dbcRuntimeUnchanged: true,
    dbcRegistryRuntimeUnchanged: true,
    launchCountUnchanged: true,
    templateCountUnchanged: true,
    onlyPlannedLaunchpadRoleAdded: true,
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.join(root, "deployments/mainnet/launchpad-v1-simulation.json"), serialized);
console.log(JSON.stringify({
  deployments: deploymentReceipts.length,
  configurations: configurationReceipts.length,
  totalGas: result.gas.total,
  bufferedGas: result.gas.recommendedGasLimitWith20PercentBuffer,
  resultSha256: createHash("sha256").update(serialized).digest("hex"),
}));
