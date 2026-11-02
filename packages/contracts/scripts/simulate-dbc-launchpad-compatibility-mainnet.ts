import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/dbc-launchpad-compatibility-plan.json");
const planBytes = await readFile(planPath);
const plan = JSON.parse(planBytes.toString("utf8")) as any;
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.broadcastAllowed, false);

type Build = { abi: Abi; bytecode: { object: Hex } };
const build = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Build;
const [factoryBuild, deployerBuild] = await Promise.all([
  build("LaunchFactory"),
  build("VirtualPoolDeployer"),
]);
const timelockAbi = [
  {
    type: "function", name: "schedule", stateMutability: "nonpayable", inputs: [
      { name: "target", type: "address" }, { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }, { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" }, { name: "delay", type: "uint256" },
    ], outputs: [],
  },
  {
    type: "function", name: "execute", stateMutability: "payable", inputs: [
      { name: "target", type: "address" }, { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" }, { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ], outputs: [{ name: "", type: "bytes" }],
  },
] as const;

const rpc = process.env.LOCAL_FORK_RPC_URL ?? "http://127.0.0.1:18549";
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc);
const client = createPublicClient({ chain, transport });
assert.equal(await client.getChainId(), 4663);
const deployer = getAddress(plan.deployer) as Address;
const safe = getAddress(plan.safe) as Address;
await Promise.all([deployer, safe].map(async (account) => {
  await client.request({ method: "anvil_impersonateAccount", params: [account] } as any);
  await client.request({ method: "anvil_setBalance", params: [account, "0x8ac7230489e80000"] } as any);
}));
const deployerWallet = createWalletClient({ account: deployer, chain, transport });
const safeWallet = createWalletClient({ account: safe, chain, transport });
const receipts: Array<{ step: string; hash: Hex; gasUsed: string }> = [];
const record = async (step: string, hash: Hex) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${step} reverted`);
  receipts.push({ step, hash, gasUsed: receipt.gasUsed.toString() });
  return receipt;
};

const poolReceipt = await record("deploy-virtual-pool-deployer", await deployerWallet.deployContract({
  abi: deployerBuild.abi,
  bytecode: deployerBuild.bytecode.object,
  args: [safe],
}));
assert.equal(getAddress(poolReceipt.contractAddress!), getAddress(plan.newPoolDeployer));
const implementationReceipt = await record(
  "deploy-launch-factory-implementation",
  await deployerWallet.deployContract({ abi: factoryBuild.abi, bytecode: factoryBuild.bytecode.object }),
);
assert.equal(getAddress(implementationReceipt.contractAddress!), getAddress(plan.newFactoryImplementation));

await record("bind-new-deployer", await safeWallet.sendTransaction({
  to: getAddress(plan.newPoolDeployer),
  data: plan.governance.bindData,
}));
assert.equal(getAddress(await client.readContract({
  address: getAddress(plan.newPoolDeployer), abi: deployerBuild.abi, functionName: "factory",
}) as Address), getAddress(plan.factory));

await record("schedule-upgrade", await safeWallet.sendTransaction({
  to: getAddress(plan.timelock),
  data: plan.governance.scheduleData,
}));
await client.request({ method: "evm_increaseTime", params: [plan.delaySeconds + 1] } as any);
await client.request({ method: "evm_mine", params: [] } as any);
await record("execute-upgrade", await safeWallet.sendTransaction({
  to: getAddress(plan.timelock),
  data: plan.governance.executeData,
}));
await record("rotate-pool-deployer", await safeWallet.sendTransaction({
  to: getAddress(plan.factory),
  data: plan.governance.setPoolDeployerData,
}));
assert.equal(getAddress(await client.readContract({
  address: getAddress(plan.factory), abi: factoryBuild.abi, functionName: "poolDeployer",
}) as Address), getAddress(plan.newPoolDeployer));

const gasUsed = receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n);
const output = {
  schemaVersion: 1,
  environment: "mainnet-fork",
  chainId: 4663,
  planSha256: createHash("sha256").update(planBytes).digest("hex"),
  factory: plan.factory,
  implementation: plan.newFactoryImplementation,
  poolDeployer: plan.newPoolDeployer,
  receipts,
  targetCallGasUsed: gasUsed.toString(),
  verified: true,
  broadcastAllowed: false,
};
const outputPath = path.join(root, "deployments/mainnet/dbc-launchpad-compatibility-simulation.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ...output, outputPath }));
