import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/protected-guard-upgrade-plan.json",
);
const journalPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/protected-guard-upgrade-execution.private.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as any;
const unsigned = { ...plan };
delete unsigned.planSha256;
assert.equal(
  createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  plan.planSha256,
  "PLAN_HASH_DRIFT",
);
assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.delaySeconds, 300);
assert.equal(plan.broadcastAllowed, false);
assert.equal(plan.graduationAllowed, false);

const confirmedPlan = process.argv.find((value) => value.startsWith("--confirm-plan="))?.split("=")[1];
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(confirmedPlan, plan.planSha256, "EXACT_PLAN_CONFIRMATION_REQUIRED");
assert.equal(capArg, "0.00031", "UNAPPROVED_FEE_CAP");
const cap = parseEther(capArg);

const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(privateKey && /^0x[\da-f]{64}$/iu.test(privateKey), "INVALID_DEPLOYER_KEY");
const relayer = privateKeyToAccount(privateKey as Hex);
assert.equal(relayer.address, getAddress(plan.deployer), "RELAYER_MISMATCH");

const transport = http(rpcUrl, { timeout: 30_000, retryCount: 2 });
const client = createPublicClient({ transport });
const wallet = createWalletClient({ account: relayer, transport });
assert.equal(await client.getChainId(), 4663);

type ReceiptRecord = {
  label: string;
  transactionHash: Hex;
  blockNumber: string;
  contractAddress?: Address;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
};
let journal: { planSha256: string; receipts: ReceiptRecord[] } = {
  planSha256: plan.planSha256,
  receipts: [],
};
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(journal.planSha256, plan.planSha256, "JOURNAL_PLAN_MISMATCH");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
let spent = journal.receipts.reduce((sum, receipt) => sum + BigInt(receipt.totalFeeWei), 0n);
const persist = async (status: string) =>
  writeFile(
    journalPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: "mainnet",
        chainId: 4663,
        planSha256: plan.planSha256,
        status,
        capWei: cap.toString(),
        receipts: journal.receipts,
        totalFeeWei: spent.toString(),
        totalFeeEth: formatEther(spent),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
const record = async (label: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${label}:REVERTED`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `${label}:FEE_CAP_EXCEEDED`);
  journal.receipts.push({
    label,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    ...(receipt.contractAddress ? { contractAddress: getAddress(receipt.contractAddress) } : {}),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
  });
  await persist("in-progress");
};
const already = (label: string) => journal.receipts.some((receipt) => receipt.label === label);
const send = async (label: string, input: { to?: Address; data: Hex }) => {
  if (already(label)) return;
  const estimatedGas = await client.estimateGas({ account: relayer, ...input });
  const gasPrice = await client.getGasPrice();
  assert(spent + (estimatedGas * gasPrice * 130n) / 100n <= cap, `${label}:FEE_GUARD`);
  const hash = await wallet.sendTransaction({ account: relayer, ...input });
  await record(label, await client.waitForTransactionReceipt({ hash, confirmations: 1 }));
};

const artifact = async (name: string) =>
  JSON.parse(
    await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
  ) as { abi: any; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const [registryBuild, factoryBuild] = await Promise.all([
  artifact("LaunchConfigRegistry"),
  artifact("LaunchFactory"),
]);
if (!already("deploy-config-registry-implementation")) {
  assert.equal(
    await client.getTransactionCount({ address: relayer.address, blockTag: "pending" }),
    plan.deployerNonce,
    "DEPLOYER_NONCE_DRIFT",
  );
}
await send("deploy-config-registry-implementation", { data: registryBuild.bytecode.object });
await send("deploy-launch-factory-implementation", { data: factoryBuild.bytecode.object });
const deployedRegistry = journal.receipts.find(
  (receipt) => receipt.label === "deploy-config-registry-implementation",
)?.contractAddress;
const deployedFactory = journal.receipts.find(
  (receipt) => receipt.label === "deploy-launch-factory-implementation",
)?.contractAddress;
assert.equal(deployedRegistry, getAddress(plan.newImplementations.configRegistry));
assert.equal(deployedFactory, getAddress(plan.newImplementations.launchFactory));

const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationDone(bytes32) view returns (bool)",
]);
assert.equal(
  await client.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getMinDelay" }),
  300n,
  "TIMELOCK_DELAY_DRIFT",
);
const relaySafe = async (label: string, target: Address, data: Hex) => {
  if (already(label)) return;
  const prepared = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.safe),
    to: getAddress(target),
    data,
    relayer,
  });
  await send(label, { to: prepared.to, data: prepared.data });
};
const scheduledTimestamp = await client.readContract({
  address: plan.timelock,
  abi: timelockAbi,
  functionName: "getTimestamp",
  args: [plan.governance.operationId],
});
if (scheduledTimestamp === 0n) {
  await relaySafe("safe-schedule-batch-upgrade", plan.timelock, plan.governance.scheduleData);
}
while (
  !(await client.readContract({
    address: plan.timelock,
    abi: timelockAbi,
    functionName: "isOperationDone",
    args: [plan.governance.operationId],
  }))
) {
  const timestamp = await client.readContract({
    address: plan.timelock,
    abi: timelockAbi,
    functionName: "getTimestamp",
    args: [plan.governance.operationId],
  });
  if ((await client.getBlock()).timestamp >= timestamp) break;
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await relaySafe("safe-execute-batch-upgrade", plan.timelock, plan.governance.executeData);
assert.equal(
  await client.readContract({
    address: plan.timelock,
    abi: timelockAbi,
    functionName: "isOperationDone",
    args: [plan.governance.operationId],
  }),
  true,
  "TIMELOCK_OPERATION_NOT_DONE",
);
const [guardAction, templateAction] = plan.governance.remainingActions;
const quoteAsset = getAddress(`0x${guardAction.data.slice(34, 74)}`);
await relaySafe("safe-require-protected-msft-launches", guardAction.target, guardAction.data);
await relaySafe("safe-create-msft-canary-template", templateAction.target, templateAction.data);

const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const [registrySlot, factorySlot, protectedOnly, template] = await Promise.all([
  client.getStorageAt({ address: plan.proxies.configRegistry, slot: implementationSlot }),
  client.getStorageAt({ address: plan.proxies.launchFactory, slot: implementationSlot }),
  client.readContract({
    address: plan.proxies.configRegistry,
    abi: registryBuild.abi,
    functionName: "quoteTokenProtectedOnly",
    args: [quoteAsset],
  }),
  client.readContract({
    address: plan.proxies.configRegistry,
    abi: registryBuild.abi,
    functionName: "templateConfig",
    args: [2n],
  }) as Promise<any>,
]);
assert.equal(getAddress(`0x${registrySlot!.slice(-40)}`), getAddress(plan.newImplementations.configRegistry));
assert.equal(getAddress(`0x${factorySlot!.slice(-40)}`), getAddress(plan.newImplementations.launchFactory));
assert.equal(protectedOnly, true);
assert.equal(getAddress(template.quoteToken ?? template[0]), quoteAsset);
assert(
  journal.receipts.length === 5 || journal.receipts.length === 6,
  "RECEIPT_COUNT_MISMATCH",
);
await persist("verified");
console.log(
  JSON.stringify(
    {
      planSha256: plan.planSha256,
      status: "verified",
      transactions: journal.receipts.map(({ label, transactionHash }) => ({ label, transactionHash })),
      totalFeeEth: formatEther(spent),
      capEth: formatEther(cap),
      templateId: "2",
      quoteTradingEnabled: true,
      graduationEnabled: false,
    },
    null,
    2,
  ),
);
