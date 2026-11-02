import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { save, timelockAbi } from "./permissionless-upgrade-support.js";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex } }>;
type Plan = Readonly<{
  chainId: 46630;
  deployer: Address;
  governance: Address;
  configuredUpgrader: Address;
  factoryTimelock: Address;
  startingNonce: number;
  proxies: Record<"poolFactory" | "configRegistry" | "escrow" | "manager", Address>;
  liveDependencies: { oldDammAdapter: Address };
  deploymentOrder: readonly string[];
  addresses: Record<string, Address>;
  deploymentDataHashes: Record<string, Hex>;
  estimates: { deploymentGas: Record<string, string>; bufferedMaximumFeeWei: string };
  authorization: { broadcastAllowed: false };
}>;
type Journal = {
  planHash: string;
  transactions: Array<{
    stage: string;
    hash: Hex;
    blockNumber: string;
    gasUsed: string;
    effectiveGasPrice: string;
    feeWei: string;
    contractAddress?: Address;
  }>;
  complete: boolean;
};

const root = path.resolve(import.meta.dirname, "../../..");
const planFile = path.join(root, "deployments/testnet/dbc-dlmm-graduation-plan.json");
const journalFile = path.join(root, "deployments/testnet/dbc-dlmm-graduation-execution.json");
const planText = await readFile(planFile, "utf8");
const plan = JSON.parse(planText) as Plan;
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArg, "0.00022", "Execution cap differs from owner-approved cap");
const cap = parseEther(capArg);
assert(BigInt(plan.estimates.bufferedMaximumFeeWei) <= cap, "Plan exceeds approved cap");
assert.equal(plan.chainId, 46630);
assert.equal(plan.authorization.broadcastAllowed, false);
assert(process.env.RPC_URL, "RPC_URL missing");

function account(name: string, expected: Address) {
  const value = process.env[name]?.trim();
  assert(value && /^0x[\da-f]{64}$/iu.test(value), `${name} invalid`);
  const result = privateKeyToAccount(value as Hex);
  assert.equal(result.address, getAddress(expected), `${name} address mismatch`);
  return result;
}
const deployer = account("DEPLOYER_PRIVATE_KEY", plan.deployer);
const governance = account("GOVERNANCE_PRIVATE_KEY", plan.governance);
const upgrader = account("UPGRADER_PRIVATE_KEY", plan.configuredUpgrader);
const chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
const deployerWallet = createWalletClient({ account: deployer, chain, transport });
const governanceWallet = createWalletClient({ account: governance, chain, transport });
const upgraderWallet = createWalletClient({ account: upgrader, chain, transport });
assert.equal(await publicClient.getChainId(), 46630, "RPC chain mismatch");

const artifacts = Object.fromEntries(
  await Promise.all(
    ["PoolFactory", "LaunchConfigRegistry", "LPAllocationEscrow", "GraduationManager", "DammGraduationAdapter", "DlmmGraduationAdapter"].map(
      async (name) => [
        name,
        JSON.parse(
          await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
        ) as Artifact,
      ],
    ),
  ),
) as Record<string, Artifact>;
const creationData: Record<string, Hex> = {
  poolFactoryImplementation: artifacts.PoolFactory!.bytecode.object,
  configRegistryImplementation: artifacts.LaunchConfigRegistry!.bytecode.object,
  escrowImplementation: artifacts.LPAllocationEscrow!.bytecode.object,
  managerImplementation: artifacts.GraduationManager!.bytecode.object,
  dammAdapter: `0x${artifacts.DammGraduationAdapter!.bytecode.object.slice(2)}${plan.proxies.manager.slice(2).padStart(64, "0")}${plan.proxies.poolFactory.slice(2).padStart(64, "0")}` as Hex,
  dlmmAdapter: `0x${artifacts.DlmmGraduationAdapter!.bytecode.object.slice(2)}${plan.proxies.manager.slice(2).padStart(64, "0")}${plan.proxies.poolFactory.slice(2).padStart(64, "0")}${plan.governance.slice(2).padStart(64, "0")}${BigInt(25).toString(16).padStart(64, "0")}` as Hex,
};
for (const name of plan.deploymentOrder) {
  assert.equal(keccak256(creationData[name]!), plan.deploymentDataHashes[name], `${name} artifact drift`);
}

let journal: Journal;
try {
  journal = JSON.parse(await readFile(journalFile, "utf8")) as Journal;
} catch {
  journal = { planHash: keccak256(toHexUtf8(planText)), transactions: [], complete: false };
}
const done = (stage: string) => journal.transactions.some((item) => item.stage === stage);
const spent = () => journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const record = async (stage: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${stage} failed`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  journal.transactions.push({
    stage,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
    ...(receipt.contractAddress ? { contractAddress: getAddress(receipt.contractAddress) } : {}),
  });
  assert(spent() <= cap, "Approved fee cap exceeded");
  await save(journalFile, journal);
};
const recordRevert = async (stage: string, receipt: TransactionReceipt) => {
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  journal.transactions.push({
    stage,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
  });
  assert(spent() <= cap, "Approved fee cap exceeded by reverted transaction");
  await save(journalFile, journal);
};
function toHexUtf8(value: string): Hex {
  return `0x${Buffer.from(value).toString("hex")}`;
}
const gasPrice = await publicClient.getGasPrice();
const remainingCeiling = BigInt(plan.estimates.bufferedMaximumFeeWei);
assert(spent() + remainingCeiling <= cap || journal.transactions.length > 0, "Fee ceiling unavailable");

for (let index = 0; index < plan.deploymentOrder.length; ++index) {
  const name = plan.deploymentOrder[index]!;
  const stage = `deploy-${name}`;
  if (done(stage)) continue;
  const currentNonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
  assert.equal(currentNonce, plan.startingNonce + index, `${stage} nonce drift`);
  const gas = BigInt(plan.estimates.deploymentGas[name]!) * 120n / 100n;
  assert(spent() + gas * gasPrice <= cap, `${stage} can exceed cap`);
  const hash = await deployerWallet.sendTransaction({
    account: deployer,
    data: creationData[name]!,
    gas,
    gasPrice,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(getAddress(receipt.contractAddress!), getAddress(plan.addresses[name]!), `${stage} address mismatch`);
  await record(stage, receipt);
}

const proxyAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
for (const name of ["configRegistry", "escrow", "manager"] as const) {
  const stage = `upgrade-${name}`;
  if (done(stage)) continue;
  const implementation = plan.addresses[`${name}Implementation`]!;
  const hash = await upgraderWallet.writeContract({
    account: upgrader,
    address: plan.proxies[name],
    abi: proxyAbi,
    functionName: "upgradeToAndCall",
    args: [implementation, "0x"],
    gas: 100_000n,
    gasPrice,
  });
  await record(stage, await publicClient.waitForTransactionReceipt({ hash }));
}

const poolUpgradeData = encodeFunctionData({
  abi: proxyAbi,
  functionName: "upgradeToAndCall",
  args: [plan.addresses.poolFactoryImplementation!, "0x"],
});
const predecessor = `0x${"00".repeat(32)}` as Hex;
const salt = keccak256(toHexUtf8(`ZKBLAST_DBC_DLMM_TESTNET_${plan.startingNonce}`));
const operation = [plan.proxies.poolFactory, 0n, poolUpgradeData, predecessor, salt] as const;
const operationHashAbi = parseAbi([
  "function hashOperation(address,uint256,bytes,bytes32,bytes32) view returns (bytes32)",
]);
const operationId = await publicClient.readContract({
  address: plan.factoryTimelock,
  abi: operationHashAbi,
  functionName: "hashOperation",
  args: operation,
});
const delay = await publicClient.readContract({ address: plan.factoryTimelock, abi: timelockAbi, functionName: "getMinDelay" });
assert.equal(delay, 300n, "Timelock delay changed");
if (!done("schedule-poolFactory")) {
  const hash = await governanceWallet.writeContract({
    account: governance,
    address: plan.factoryTimelock,
    abi: timelockAbi,
    functionName: "schedule",
    args: [...operation, delay],
    gas: 150_000n,
    gasPrice,
  });
  await record("schedule-poolFactory", await publicClient.waitForTransactionReceipt({ hash }));
}
if (!done("execute-poolFactory") && !done("execute-poolFactory-reverted-1")) {
  const scheduled = journal.transactions.find((item) => item.stage === "schedule-poolFactory")!;
  const latest = await publicClient.getBlockNumber();
  for (let blockNumber = BigInt(scheduled.blockNumber); blockNumber <= latest; ++blockNumber) {
    const block = await publicClient.getBlock({ blockNumber, includeTransactions: true });
    for (const transaction of block.transactions) {
      if (
        typeof transaction !== "string"
          && getAddress(transaction.from) === governance.address
          && transaction.to !== null
          && getAddress(transaction.to) === getAddress(plan.factoryTimelock)
          && transaction.hash !== scheduled.hash
      ) {
        const receipt = await publicClient.getTransactionReceipt({ hash: transaction.hash });
        if (receipt.status === "reverted") {
          await recordRevert("execute-poolFactory-reverted-1", receipt);
        }
      }
    }
  }
}
let readyAt = await publicClient.readContract({
  address: plan.factoryTimelock,
  abi: timelockAbi,
  functionName: "getTimestamp",
  args: [operationId],
});
while (!done("execute-poolFactory") && BigInt(Math.floor(Date.now() / 1000)) < readyAt) {
  process.stdout.write(JSON.stringify({ status: "timelock-wait", readyAt: readyAt.toString(), spentEth: formatEther(spent()) }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
if (!done("execute-poolFactory")) {
  const hash = await governanceWallet.writeContract({
    account: governance,
    address: plan.factoryTimelock,
    abi: timelockAbi,
    functionName: "execute",
    args: operation,
    gas: 150_000n,
    gasPrice,
  });
  await record("execute-poolFactory", await publicClient.waitForTransactionReceipt({ hash }));
}

const manager = artifacts.GraduationManager!;
for (const [stage, adapter, allowed] of [
  ["disable-legacy-damm", plan.liveDependencies.oldDammAdapter, false],
  ["allow-versioned-damm", plan.addresses.dammAdapter!, true],
  ["allow-versioned-dlmm", plan.addresses.dlmmAdapter!, true],
] as const) {
  if (done(stage)) continue;
  const hash = await governanceWallet.writeContract({
    account: governance,
    address: plan.proxies.manager,
    abi: manager.abi,
    functionName: "setAdapter",
    args: [adapter, allowed],
    gas: 100_000n,
    gasPrice,
  });
  await record(stage, await publicClient.waitForTransactionReceipt({ hash }));
}

const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
for (const [name, expected] of [
  ["poolFactory", plan.addresses.poolFactoryImplementation],
  ["configRegistry", plan.addresses.configRegistryImplementation],
  ["escrow", plan.addresses.escrowImplementation],
  ["manager", plan.addresses.managerImplementation],
] as const) {
  const slot = await publicClient.getStorageAt({ address: plan.proxies[name], slot: implementationSlot });
  assert(slot, `${name} implementation slot empty`);
  assert.equal(getAddress(`0x${slot.slice(-40)}`), getAddress(expected!), `${name} implementation mismatch`);
}
const adapterReadAbi = parseAbi([
  "function adapterAllowed(address) view returns (bool)",
  "function manager() view returns (address)",
  "function factory() view returns (address)",
  "function adapterVersion() view returns (uint32)",
  "function migrationMode() view returns (uint8)",
  "function poolAdministrator() view returns (address)",
  "function binStepBps() view returns (uint16)",
  "function permissionlessCreation() view returns (bool)",
]);
assert.equal(await publicClient.readContract({ address: plan.proxies.manager, abi: adapterReadAbi, functionName: "adapterAllowed", args: [plan.liveDependencies.oldDammAdapter] }), false);
for (const adapter of [plan.addresses.dammAdapter!, plan.addresses.dlmmAdapter!]) {
  assert.equal(await publicClient.readContract({ address: plan.proxies.manager, abi: adapterReadAbi, functionName: "adapterAllowed", args: [adapter] }), true);
  assert.equal(getAddress(await publicClient.readContract({ address: adapter, abi: adapterReadAbi, functionName: "manager" })), getAddress(plan.proxies.manager));
  assert.equal(getAddress(await publicClient.readContract({ address: adapter, abi: adapterReadAbi, functionName: "factory" })), getAddress(plan.proxies.poolFactory));
  assert.equal(await publicClient.readContract({ address: adapter, abi: adapterReadAbi, functionName: "adapterVersion" }), 1);
}
assert.equal(await publicClient.readContract({ address: plan.addresses.dlmmAdapter!, abi: adapterReadAbi, functionName: "migrationMode" }), 1);
assert.equal(getAddress(await publicClient.readContract({ address: plan.addresses.dlmmAdapter!, abi: adapterReadAbi, functionName: "poolAdministrator" })), governance.address);
assert.equal(await publicClient.readContract({ address: plan.addresses.dlmmAdapter!, abi: adapterReadAbi, functionName: "binStepBps" }), 25);
assert.equal(await publicClient.readContract({ address: plan.proxies.poolFactory, abi: adapterReadAbi, functionName: "permissionlessCreation" }), true);

journal.complete = true;
await save(journalFile, journal);
console.log(JSON.stringify({
  status: "complete",
  transactions: journal.transactions.length,
  totalFeeWei: spent().toString(),
  totalFeeEth: formatEther(spent()),
  capEth: formatEther(cap),
  poolFactory: plan.proxies.poolFactory,
  manager: plan.proxies.manager,
  dammAdapter: plan.addresses.dammAdapter,
  dlmmAdapter: plan.addresses.dlmmAdapter,
}, null, 2));
