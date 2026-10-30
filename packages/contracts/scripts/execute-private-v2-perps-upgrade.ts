import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http,
  parseAbi, parseEther, type Abi, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";
import { runtimeFor } from "./permissionless-upgrade-support.js";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert(capArg, "--cap-eth is required");
const cap = parseEther(capArg);
const approvedCap = parseEther(environment === "testnet" ? "0.00012" : "0.00031");
assert.equal(cap, approvedCap, "Upgrade fee cap differs from owner-approved ceiling");
const key = (name: string) => {
  const value = process.env[name];
  assert(value && /^0x[0-9a-f]{64}$/iu.test(value), `${name} is invalid`);
  return value as Hex;
};
const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
const plan = JSON.parse(await readFile(path.join(root, `deployments/${environment}/private-v2-perps-upgrade-plan.json`), "utf8")) as any;
assert.equal(deployer.address, getAddress(plan.deployer), "Deployer does not match upgrade plan");
assert(BigInt(plan.gas.feeCeilingWei) <= cap, "Planned fee exceeds approved cap");
const artifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/PrivateVaultV2.sol/PrivateVaultV2.json"), "utf8")) as {
  abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex; immutableReferences?: Record<string, { start: number; length: number }[]> };
};
const chain = defineChain({
  id: plan.chainId,
  name: environment === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
const deployerClient = createWalletClient({ account: deployer, chain, transport });
assert.equal(await publicClient.getChainId(), plan.chainId, "RPC chain mismatch");
const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const currentSlot = await publicClient.getStorageAt({ address: plan.proxy, slot });
assert(currentSlot, "Proxy implementation slot is empty");
assert.equal(getAddress(`0x${currentSlot.slice(-40)}`), getAddress(plan.currentImplementation), "Implementation drift");
const pendingNonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: "pending" });
assert.equal(pendingNonce, plan.deployerNonce, "Deployer nonce changed; refresh upgrade plan");

const receipts: TransactionReceipt[] = [];
const existingImplementationCode = await publicClient.getCode({ address: plan.newImplementation });
if (!existingImplementationCode || existingImplementationCode === "0x") {
  const implementationHash = await deployerClient.deployContract({
    account: deployer, abi: artifact.abi, bytecode: artifact.bytecode.object,
  });
  const implementationReceipt = await publicClient.waitForTransactionReceipt({ hash: implementationHash });
  assert.equal(implementationReceipt.status, "success", "Implementation deployment failed");
  assert.equal(getAddress(implementationReceipt.contractAddress!), getAddress(plan.newImplementation), "Implementation address mismatch");
  receipts.push(implementationReceipt);
} else {
  assert.equal(
    existingImplementationCode,
    runtimeFor(artifact, plan.newImplementation),
    "Existing implementation runtime mismatch",
  );
}

const proxyAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
if (plan.workflow === "direct-upgrader") {
  const upgrader = privateKeyToAccount(key("UPGRADER_PRIVATE_KEY"));
  assert.equal(upgrader.address, getAddress(plan.timelock), "Testnet upgrader does not match plan");
  const wallet = createWalletClient({ account: upgrader, chain, transport });
  const hash = await wallet.writeContract({
    account: upgrader, address: plan.proxy, abi: proxyAbi, functionName: "upgradeToAndCall",
    args: [plan.newImplementation, "0x"],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", "Testnet proxy upgrade failed");
  receipts.push(receipt);
} else if (environment === "mainnet") {
  const timelockAbi = parseAbi([
    "function getTimestamp(bytes32) view returns (uint256)",
    "function isOperationDone(bytes32) view returns (bool)",
  ]);
  const schedule = await prepareSafeOperation(publicClient, {
    chainId: plan.chainId, safe: plan.governance, to: plan.timelock,
    data: plan.scheduleCalldata, relayer: deployer,
  });
  const scheduleHash = await deployerClient.sendTransaction({ account: deployer, to: schedule.to, data: schedule.data });
  const scheduleReceipt = await publicClient.waitForTransactionReceipt({ hash: scheduleHash });
  assert.equal(scheduleReceipt.status, "success", "Mainnet timelock schedule failed");
  receipts.push(scheduleReceipt);
  const readyAt = await publicClient.readContract({
    address: plan.timelock, abi: timelockAbi, functionName: "getTimestamp", args: [plan.operationId],
  });
  while (BigInt(Math.floor(Date.now() / 1000)) < readyAt) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  const execute = await prepareSafeOperation(publicClient, {
    chainId: plan.chainId, safe: plan.governance, to: plan.timelock,
    data: plan.executeCalldata, relayer: deployer,
  });
  const executeHash = await deployerClient.sendTransaction({ account: deployer, to: execute.to, data: execute.data });
  const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash });
  assert.equal(executeReceipt.status, "success", "Mainnet timelock execute failed");
  receipts.push(executeReceipt);
  assert(await publicClient.readContract({
    address: plan.timelock, abi: timelockAbi, functionName: "isOperationDone", args: [plan.operationId],
  }), "Mainnet timelock operation is not complete");
} else {
  const governance = privateKeyToAccount(key("GOVERNANCE_PRIVATE_KEY"));
  assert.equal(governance.address, getAddress(plan.governance), "Testnet governance does not match plan");
  const wallet = createWalletClient({ account: governance, chain, transport });
  const scheduleHash = await wallet.sendTransaction({ account: governance, to: plan.timelock, data: plan.scheduleCalldata });
  const scheduleReceipt = await publicClient.waitForTransactionReceipt({ hash: scheduleHash });
  assert.equal(scheduleReceipt.status, "success", "Testnet timelock schedule failed");
  receipts.push(scheduleReceipt);
  const timelockAbi = parseAbi(["function getTimestamp(bytes32) view returns (uint256)"]);
  const readyAt = await publicClient.readContract({ address: plan.timelock, abi: timelockAbi, functionName: "getTimestamp", args: [plan.operationId] });
  while (BigInt(Math.floor(Date.now() / 1000)) < readyAt) await new Promise((resolve) => setTimeout(resolve, 15_000));
  const executeHash = await wallet.sendTransaction({ account: governance, to: plan.timelock, data: plan.executeCalldata });
  const executeReceipt = await publicClient.waitForTransactionReceipt({ hash: executeHash });
  assert.equal(executeReceipt.status, "success", "Testnet timelock execute failed");
  receipts.push(executeReceipt);
}

const finalSlot = await publicClient.getStorageAt({ address: plan.proxy, slot });
assert(finalSlot && getAddress(`0x${finalSlot.slice(-40)}`) === getAddress(plan.newImplementation), "Proxy implementation slot mismatch");
const supported = await publicClient.readContract({
  address: plan.proxy, abi: artifact.abi, functionName: "perpsAdapterAuthorized",
  args: ["0x0000000000000000000000000000000000000001"],
});
assert.equal(supported, false, "Unexpected initial adapter authorization state");
const totalFee = receipts.reduce((sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
assert(totalFee <= cap, "Actual upgrade fee exceeded approved cap");
console.log(JSON.stringify({
  environment, implementation: plan.newImplementation, proxy: plan.proxy,
  transactions: receipts.map((receipt) => receipt.transactionHash),
  totalFeeWei: totalFee.toString(), totalFeeEth: formatEther(totalFee), capEth: formatEther(cap),
  adapterAuthorizationSupported: true,
}));
