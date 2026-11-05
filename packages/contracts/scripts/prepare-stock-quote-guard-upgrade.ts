import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
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
const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL is required");

const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
const activation = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/stock-quotes/canary-activation-plan.json"),
    "utf8",
  ),
) as any;
assert.equal(manifest.chainId, 4663, "Mainnet chain mismatch");

type Build = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const artifact = async (name: string) =>
  JSON.parse(
    await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
  ) as Build;
const [registryBuild, factoryBuild] = await Promise.all([
  artifact("LaunchConfigRegistry"),
  artifact("LaunchFactory"),
]);

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663, "RPC chain mismatch");

const deployer = getAddress(manifest.deployerAddress);
const safe = getAddress(manifest.roles.defaultAdmin);
const timelock = getAddress(manifest.roles.upgrader);
const configRegistry = getAddress(manifest.dbc.configRegistry);
const launchFactory = getAddress(manifest.dbc.launchFactory);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)",
  "function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable",
]);
const uupsAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
const safeAbi = parseAbi(["function nonce() view returns (uint256)"]);

const [block, deployerNonce, balance, gasPrice, delay, safeNonce, registrySlot, factorySlot] =
  await Promise.all([
    client.getBlockNumber(),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.getBalance({ address: deployer }),
    client.getGasPrice(),
    client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.getStorageAt({ address: configRegistry, slot: implementationSlot }),
    client.getStorageAt({ address: launchFactory, slot: implementationSlot }),
  ]);
assert.equal(delay, 300n, "Upgrade timelock must remain 5 minutes");
assert.equal(safeNonce, 130n, "Expected the first three activation actions to be confirmed");
assert(registrySlot && factorySlot, "Implementation slot is empty");

const newRegistryImplementation = getContractAddress({ from: deployer, nonce: BigInt(deployerNonce) });
const newFactoryImplementation = getContractAddress({
  from: deployer,
  nonce: BigInt(deployerNonce + 1),
});
const targets = [configRegistry, launchFactory] as const;
const values = [0n, 0n] as const;
const payloads = [
  encodeFunctionData({
    abi: uupsAbi,
    functionName: "upgradeToAndCall",
    args: [newRegistryImplementation, "0x"],
  }),
  encodeFunctionData({
    abi: uupsAbi,
    functionName: "upgradeToAndCall",
    args: [newFactoryImplementation, "0x"],
  }),
] as const;
const salt = keccak256(
  encodeAbiParameters(
    [{ type: "string" }, { type: "address" }, { type: "address" }],
    ["ZKBLAST_STOCK_QUOTE_PROTECTED_GUARD_V1", newRegistryImplementation, newFactoryImplementation],
  ),
);
const operationId = keccak256(
  encodeAbiParameters(
    [
      { type: "address[]" },
      { type: "uint256[]" },
      { type: "bytes[]" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [targets, values, payloads, zeroHash, salt],
  ),
);
const scheduleData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "scheduleBatch",
  args: [targets, values, payloads, zeroHash, salt, delay],
});
const executeData = encodeFunctionData({
  abi: timelockAbi,
  functionName: "executeBatch",
  args: [targets, values, payloads, zeroHash, salt],
});

const guardAction = activation.actions.find(
  ({ name }: { name: string }) => name === "require-protected-msft-launches",
);
const templateAction = activation.actions.find(
  ({ name }: { name: string }) => name === "create-msft-canary-template",
);
assert(guardAction && templateAction, "Remaining activation actions missing");

const [registryDeploymentGas, factoryDeploymentGas] = await Promise.all([
  client.estimateGas({ account: deployer, data: registryBuild.bytecode.object }),
  client.estimateGas({ account: deployer, data: factoryBuild.bytecode.object }),
]);
const safeGasCeilingPerOperation = 600_000n;
const safeOperations = 4n;
const modeledGas =
  registryDeploymentGas + factoryDeploymentGas + safeGasCeilingPerOperation * safeOperations;
const feeCeiling = modeledGas * gasPrice * 2n;
const unsignedPlan = {
  schemaVersion: 1,
  feature: "stock-quote-protected-guard-upgrade",
  environment: "mainnet",
  chainId: 4663,
  broadcastAllowed: false,
  graduationAllowed: false,
  observedBlock: block.toString(),
  deployer,
  deployerNonce,
  deployerBalanceWei: balance.toString(),
  safe,
  safeNonce: safeNonce.toString(),
  timelock,
  delaySeconds: Number(delay),
  proxies: { configRegistry, launchFactory },
  currentImplementations: {
    configRegistry: getAddress(`0x${registrySlot.slice(-40)}`),
    launchFactory: getAddress(`0x${factorySlot.slice(-40)}`),
  },
  newImplementations: { configRegistry: newRegistryImplementation, launchFactory: newFactoryImplementation },
  artifacts: {
    configRegistryCreationCodeHash: keccak256(registryBuild.bytecode.object),
    configRegistryRuntimeCodeHash: keccak256(registryBuild.deployedBytecode.object),
    launchFactoryCreationCodeHash: keccak256(factoryBuild.bytecode.object),
    launchFactoryRuntimeCodeHash: keccak256(factoryBuild.deployedBytecode.object),
  },
  governance: {
    predecessor: zeroHash,
    salt,
    operationId,
    scheduleData,
    executeData,
    remainingActions: [guardAction, templateAction],
  },
  sequence: [
    "deploy-config-registry-implementation",
    "deploy-launch-factory-implementation",
    "safe-schedule-batch-upgrade",
    "wait-300-seconds",
    "safe-execute-batch-upgrade",
    "safe-require-protected-msft-launches",
    "safe-create-msft-canary-template",
    "verify-onchain",
  ],
  gas: {
    sampledGasPriceWei: gasPrice.toString(),
    configRegistryDeployment: registryDeploymentGas.toString(),
    launchFactoryDeployment: factoryDeploymentGas.toString(),
    safeGasCeilingPerOperation: safeGasCeilingPerOperation.toString(),
    modeledTotal: modeledGas.toString(),
    feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
};
const planSha256 = createHash("sha256").update(JSON.stringify(unsignedPlan)).digest("hex");
const plan = { ...unsignedPlan, planSha256 };
const output = path.join(
  root,
  "deployments/mainnet/stock-quotes/protected-guard-upgrade-plan.json",
);
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      observedBlock: plan.observedBlock,
      safeNonce: plan.safeNonce,
      currentImplementations: plan.currentImplementations,
      newImplementations: plan.newImplementations,
      delaySeconds: plan.delaySeconds,
      transactionCount: 6,
      modeledGas: plan.gas.modeledTotal,
      feeCeilingEth: plan.gas.feeCeilingEth,
      deployerBalanceEth: formatEther(balance),
      planSha256,
      broadcastAllowed: false,
      output,
    },
    null,
    2,
  ),
);
