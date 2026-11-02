import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");

const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(manifest.chainId, 4663, "Mainnet chain mismatch");

type Build = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const build = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Build;
const [factoryBuild, deployerBuild] = await Promise.all([
  build("LaunchFactory"),
  build("VirtualPoolDeployer"),
]);

const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 }),
});
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");

const deployer = getAddress(manifest.deployerAddress);
const safe = getAddress(manifest.roles.defaultAdmin);
const timelock = getAddress(manifest.roles.upgrader);
const factory = getAddress(manifest.dbc.launchFactory);
const currentPoolDeployer = getAddress(manifest.dbc.virtualPoolDeployer);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable returns (bytes)",
]);
const safeAbi = parseAbi(["function nonce() view returns (uint256)"]);
const deployerAbi = parseAbi([
  "function binder() view returns (address)",
  "function factory() view returns (address)",
  "function bindFactory(address)",
]);

const [block, nonce, safeNonce, balance, gasPrice, delay, storedImplementation, livePoolDeployer] =
  await Promise.all([
    client.getBlockNumber(),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.getBalance({ address: deployer }),
    client.getGasPrice(),
    client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" }),
    client.getStorageAt({ address: factory, slot: implementationSlot }),
    client.readContract({ address: factory, abi: factoryBuild.abi, functionName: "poolDeployer" }),
  ]);
assert.equal(delay, 300n, "DBC upgrade timelock must remain 5 minutes");
assert(storedImplementation, "LaunchFactory implementation slot is empty");
assert.equal(getAddress(livePoolDeployer as Address), currentPoolDeployer, "Manifest pool deployer drift");

const newPoolDeployer = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
const newFactoryImplementation = getContractAddress({ from: deployer, nonce: BigInt(nonce + 1) });
const poolDeploymentData = encodeDeployData({
  abi: deployerBuild.abi,
  bytecode: deployerBuild.bytecode.object,
  args: [safe],
});
const factoryDeploymentData = factoryBuild.bytecode.object;
const bindData = encodeFunctionData({
  abi: deployerAbi,
  functionName: "bindFactory",
  args: [factory],
});
const upgradeData = encodeFunctionData({
  abi: factoryBuild.abi,
  functionName: "upgradeToAndCall",
  args: [newFactoryImplementation, "0x"],
});
const setPoolDeployerData = encodeFunctionData({
  abi: factoryBuild.abi,
  functionName: "setPoolDeployer",
  args: [newPoolDeployer],
});
const salt = keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }],
  ["ZKBLAST_DBC_LAUNCHPAD_COMPATIBILITY_V1", 4663n, factory, newFactoryImplementation, newPoolDeployer],
));
const operation = [factory, 0n, upgradeData, zeroHash, salt] as const;
const operationId = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }],
  operation,
));
const scheduleData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "schedule",
  args: [...operation, delay],
});
const executeData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "execute",
  args: operation,
});

const [poolDeploymentGas, factoryDeploymentGas] = await Promise.all([
  client.estimateGas({ account: deployer, data: poolDeploymentData }),
  client.estimateGas({ account: deployer, data: factoryDeploymentData }),
]);
// Four 2-of-2 Safe executions: bind, schedule, execute, and rotate. This is deliberately
// conservative because exact signed Safe calldata is produced only by the broadcast script.
const safeGasCeilingPerOperation = 500_000n;
const modeledGas = poolDeploymentGas + factoryDeploymentGas + safeGasCeilingPerOperation * 4n;
const feeCeiling = modeledGas * gasPrice * 2n;
const currentImplementation = getAddress(`0x${storedImplementation.slice(-40)}`);
const plan = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  observedBlock: block.toString(),
  broadcastAllowed: false,
  deployer,
  deployerNonce: nonce,
  deployerBalanceWei: balance.toString(),
  deployerBalanceEth: formatEther(balance),
  safe,
  safeNonce: safeNonce.toString(),
  timelock,
  delaySeconds: Number(delay),
  factory,
  currentImplementation,
  currentPoolDeployer,
  newFactoryImplementation,
  newPoolDeployer,
  artifacts: {
    factoryCreationCodeHash: keccak256(factoryDeploymentData),
    factoryRuntimeCodeHash: keccak256(factoryBuild.deployedBytecode.object),
    poolDeployerCreationCodeHash: keccak256(poolDeploymentData),
    poolDeployerRuntimeCodeHash: keccak256(deployerBuild.deployedBytecode.object),
  },
  governance: {
    predecessor: zeroHash,
    salt,
    operationId,
    bindData,
    upgradeData,
    scheduleData,
    executeData,
    setPoolDeployerData,
  },
  sequence: [
    "deploy-virtual-pool-deployer",
    "deploy-launch-factory-implementation",
    "safe-bind-new-deployer-to-existing-factory",
    "safe-schedule-upgrade",
    "wait-300-seconds",
    "safe-execute-upgrade",
    "safe-rotate-factory-pool-deployer",
    "verify-bound-token-lifecycle",
  ],
  gas: {
    sampledGasPriceWei: gasPrice.toString(),
    poolDeployerDeployment: poolDeploymentGas.toString(),
    factoryImplementationDeployment: factoryDeploymentGas.toString(),
    safeGasCeilingPerOperation: safeGasCeilingPerOperation.toString(),
    modeledTotal: modeledGas.toString(),
    feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(root, "deployments/mainnet/dbc-launchpad-compatibility-plan.json");
await writeFile(output, serialized);
console.log(JSON.stringify({
  observedBlock: plan.observedBlock,
  deployerNonce: nonce,
  safeNonce: plan.safeNonce,
  currentImplementation,
  newFactoryImplementation,
  currentPoolDeployer,
  newPoolDeployer,
  delaySeconds: plan.delaySeconds,
  modeledGas: plan.gas.modeledTotal,
  feeCeilingEth: plan.gas.feeCeilingEth,
  planSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
  output,
}));
