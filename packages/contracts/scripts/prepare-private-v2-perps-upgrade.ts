import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, encodeAbiParameters, encodeFunctionData, formatEther, getAddress,
  getContractAddress, http, keccak256, parseAbi, zeroHash, type Abi, type Address, type Hex,
} from "viem";
import { runtimeFor } from "./permissionless-upgrade-support.js";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8")) as any;
const shieldedDeployment = environment === "testnet"
  ? JSON.parse(await readFile(path.join(root, "deployments/testnet/shielded-v2.json"), "utf8")) as any
  : null;
const build = JSON.parse(await readFile(path.join(root, "packages/contracts/out/PrivateVaultV2.sol/PrivateVaultV2.json"), "utf8")) as {
  abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex };
};
const proxy = getAddress(manifest.shieldedV2.vault);
const timelock = getAddress(shieldedDeployment?.upgrader ?? manifest.roles.upgrader);
const governance = getAddress(manifest.roles.defaultAdmin);
const deployer = getAddress(manifest.deployerAddress);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable returns (bytes)",
]);
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const [block, nonce, stored, timelockCode, gasPrice, deployerBalance] = await Promise.all([
  client.getBlockNumber(), client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getStorageAt({ address: proxy, slot: implementationSlot }),
  client.getCode({ address: timelock }),
  client.getGasPrice(), client.getBalance({ address: deployer }),
]);
assert(stored, "PrivateVaultV2 implementation slot is empty");
const isTimelock = Boolean(timelockCode && timelockCode !== "0x");
const delay = isTimelock
  ? await client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" })
  : 0n;
if (environment === "mainnet") {
  assert(isTimelock, "Mainnet PrivateVaultV2 upgrader must be a timelock contract");
  assert.equal(delay, 300n, "PrivateVaultV2 timelock must be 5 minutes");
}
const currentImplementation = getAddress(`0x${stored.slice(-40)}`);
let newImplementation = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
let implementationAlreadyDeployed = false;
const reuseArg = process.argv.find((value) => value.startsWith("--reuse-implementation="))?.split("=")[1];
if (reuseArg) {
  const candidate = getAddress(reuseArg);
  const candidateCode = await client.getCode({ address: candidate });
  assert(candidateCode && candidateCode !== "0x", "Reusable implementation has no runtime code");
  assert.equal(keccak256(candidateCode), keccak256(runtimeFor(build, candidate)), "Reusable implementation runtime mismatch");
  newImplementation = candidate;
  implementationAlreadyDeployed = true;
}
try {
  const previousPlan = JSON.parse(await readFile(path.join(root, `deployments/${environment}/private-v2-perps-upgrade-plan.json`), "utf8")) as any;
  const previousCode = await client.getCode({ address: previousPlan.newImplementation });
  if (!implementationAlreadyDeployed &&
    previousCode && previousCode !== "0x"
      && keccak256(previousCode) === keccak256(runtimeFor(build, getAddress(previousPlan.newImplementation)))
  ) {
    newImplementation = getAddress(previousPlan.newImplementation);
    implementationAlreadyDeployed = true;
  }
} catch { /* A first plan has no reusable implementation. */ }
assert.notEqual(currentImplementation, newImplementation, "Predicted implementation equals current implementation");
const upgradeCalldata = encodeFunctionData({
  abi: build.abi, functionName: "upgradeToAndCall", args: [newImplementation, "0x"],
});
const creationCodeHash = keccak256(build.bytecode.object);
const salt = keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
  ["ZKBLAST_PRIVATE_V2_PERPS_SUPPORT", BigInt(manifest.chainId), proxy, creationCodeHash],
));
const operation = [proxy, 0n, upgradeCalldata, zeroHash, salt] as const;
const operationId = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }],
  operation,
));
const scheduleCalldata = encodeFunctionData({ abi: timelockAbi, functionName: "schedule", args: [...operation, delay] });
const executeCalldata = encodeFunctionData({ abi: timelockAbi, functionName: "execute", args: operation });
const deploymentGas = implementationAlreadyDeployed ? 0n : await client.estimateGas({ account: deployer, data: build.bytecode.object });
const governanceOverhead = environment === "mainnet" ? 1_000_000n : 300_000n;
const modeledGas = deploymentGas + governanceOverhead * (isTimelock ? 2n : 1n);
const feeCeiling = modeledGas * gasPrice * 2n;
const plan = {
  schemaVersion: 1,
  environment,
  chainId: manifest.chainId,
  observedBlock: block.toString(),
  deployer,
  deployerNonce: nonce,
  deployerBalanceWei: deployerBalance.toString(),
  proxy,
  currentImplementation,
  newImplementation,
  implementationAlreadyDeployed,
  timelock,
  governance,
  workflow: isTimelock ? "timelock" : "direct-upgrader",
  delaySeconds: Number(delay),
  creationCodeHash,
  runtimeTemplateHash: keccak256(build.deployedBytecode.object),
  upgradeCalldata,
  upgradeCalldataHash: keccak256(upgradeCalldata),
  predecessor: zeroHash,
  salt,
  operationId,
  scheduleCalldata,
  executeCalldata,
  gas: {
    observedPriceWei: gasPrice.toString(),
    deploymentEstimate: deploymentGas.toString(),
    modeledGovernancePerStep: governanceOverhead.toString(),
    modeledTotal: modeledGas.toString(),
    feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
  scope: "Append-only PrivateVaultV2 Perps adapter support; no adapter authorization or protocol activation",
};
const output = path.join(root, `deployments/${environment}/private-v2-perps-upgrade-plan.json`);
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  environment, chainId: manifest.chainId, observedBlock: plan.observedBlock, currentImplementation,
  newImplementation, timelock, workflow: plan.workflow, delaySeconds: plan.delaySeconds, operationId,
  modeledGas: plan.gas.modeledTotal,
  feeCeilingEth: plan.gas.feeCeilingEth, deployerBalanceEth: formatEther(deployerBalance), output,
}));
