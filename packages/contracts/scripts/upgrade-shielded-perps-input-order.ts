import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters,
  encodeFunctionData, formatEther, getAddress, getContractAddress, http,
  keccak256, parseAbi, parseEther, zeroHash,
  type Abi, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";
import { runtimeFor } from "./permissionless-upgrade-support.js";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const capArgument = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArgument, "0.00022", "Upgrade cap differs from owner approval");
const cap = parseEther(capArgument);
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(key && /^0x[0-9a-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY is invalid");
const deployer = privateKeyToAccount(key as Hex);
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(deployer.address, getAddress(manifest.deployerAddress), "Deployer mismatch");
const artifact = JSON.parse(
  await readFile(path.join(root, "packages/contracts/out/ShieldedPerpAdapter.sol/ShieldedPerpAdapter.json"), "utf8"),
) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const chain = defineChain({
  id: manifest.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: deployer, chain, transport });
const proxy = getAddress(manifest.perps.shieldedAdapter);
const timelock = getAddress(manifest.roles.upgrader);
const governance = getAddress(manifest.roles.defaultAdmin);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationDone(bytes32) view returns (bool)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable returns (bytes)",
]);

const [chainId, nonce, stored, delay, gasPrice, balance] = await Promise.all([
  client.getChainId(),
  client.getTransactionCount({ address: deployer.address, blockTag: "pending" }),
  client.getStorageAt({ address: proxy, slot: implementationSlot }),
  client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" }),
  client.getGasPrice(),
  client.getBalance({ address: deployer.address }),
]);
assert.equal(chainId, manifest.chainId, "RPC chain mismatch");
assert(stored, "Adapter implementation slot is empty");
assert.equal(delay, 300n, "Adapter timelock must be 5 minutes");
const currentImplementation = getAddress(`0x${stored.slice(-40)}`);
const newImplementation = getContractAddress({ from: deployer.address, nonce: BigInt(nonce) });
const deploymentGas = await client.estimateGas({ account: deployer.address, data: artifact.bytecode.object });
const modeledFee = (deploymentGas + 2_000_000n) * gasPrice * 2n;
assert(modeledFee <= cap, "Refreshed modeled fee exceeds approved cap");
assert(balance >= cap, "Deployer balance is below approved cap");

const receipts: Array<{ step: string; receipt: TransactionReceipt }> = [];
let spent = 0n;
async function record(step: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${step} failed`);
  spent += receipt.gasUsed * receipt.effectiveGasPrice;
  assert(spent <= cap, `Actual fee exceeded cap after ${step}`);
  receipts.push({ step, receipt });
  return receipt;
}
async function guard(to: Address | undefined, data: Hex, step: string) {
  const estimate = await client.estimateGas({ account: deployer.address, ...(to ? { to } : {}), data });
  const price = await client.getGasPrice();
  assert(spent + estimate * price * 2n <= cap, `Fee guard stopped before ${step}`);
}

await guard(undefined, artifact.bytecode.object, "deploy-implementation");
const deployment = await record(
  "deploy-implementation",
  await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object }),
);
assert.equal(getAddress(deployment.contractAddress!), newImplementation, "Implementation address mismatch");
const implementationCode = await client.getCode({ address: newImplementation });
assert(implementationCode && implementationCode !== "0x", "Implementation runtime missing");
assert.equal(
  keccak256(implementationCode),
  keccak256(runtimeFor(artifact, newImplementation)),
  "Implementation runtime mismatch",
);

const upgradeData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "upgradeToAndCall",
  args: [newImplementation, "0x"],
});
const salt = keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
  ["ZKBLAST_SHIELDED_PERPS_OPEN_ORDER", BigInt(chainId), proxy, newImplementation],
));
const operation = [proxy, 0n, upgradeData, zeroHash, salt] as const;
const operationId = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }],
  operation,
));
const scheduleData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "schedule",
  args: [...operation, delay],
});
const schedule = await prepareSafeOperation(client, {
  chainId, safe: governance, to: timelock, data: scheduleData, relayer: deployer,
});
await guard(schedule.to, schedule.data, "schedule-upgrade");
await record(
  "schedule-upgrade",
  await wallet.sendTransaction({ account: deployer, to: schedule.to, data: schedule.data }),
);

const readyAt = await client.readContract({
  address: timelock, abi: timelockAbi, functionName: "getTimestamp", args: [operationId],
});
assert(readyAt > 1n, "Timelock operation was not scheduled");
process.stdout.write(`${JSON.stringify({ status: "scheduled", operationId, readyAt: readyAt.toString(), spentEth: formatEther(spent) })}\n`);
while (BigInt(Math.floor(Date.now() / 1_000)) < readyAt) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}

const executeData = encodeFunctionData({ abi: timelockAbi, functionName: "execute", args: operation });
const execute = await prepareSafeOperation(client, {
  chainId, safe: governance, to: timelock, data: executeData, relayer: deployer,
});
await guard(execute.to, execute.data, "execute-upgrade");
await record(
  "execute-upgrade",
  await wallet.sendTransaction({ account: deployer, to: execute.to, data: execute.data }),
);
const [finalSlot, done] = await Promise.all([
  client.getStorageAt({ address: proxy, slot: implementationSlot }),
  client.readContract({ address: timelock, abi: timelockAbi, functionName: "isOperationDone", args: [operationId] }),
]);
assert(finalSlot, "Final adapter implementation slot is empty");
assert.equal(getAddress(`0x${finalSlot.slice(-40)}`), newImplementation, "Adapter implementation slot mismatch");
assert(done, "Timelock operation is not complete");
const evidence = {
  schemaVersion: 1,
  chainId,
  proxy,
  previousImplementation: currentImplementation,
  implementation: newImplementation,
  timelock,
  governance,
  delaySeconds: Number(delay),
  operationId,
  transactions: receipts.map(({ step, receipt }) => ({
    step,
    hash: receipt.transactionHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
  })),
  totalFeeWei: spent.toString(),
  totalFeeEth: formatEther(spent),
  approvedCapEth: formatEther(cap),
  status: "confirmed",
};
const evidencePath = path.join(root, "deployments/mainnet/shielded-perps-open-order-upgrade.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath }));
