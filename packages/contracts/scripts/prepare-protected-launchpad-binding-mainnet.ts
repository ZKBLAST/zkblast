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
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(manifest.chainId, 4663, "Mainnet chain mismatch");

type Build = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const artifact = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Build;
const [tokenFactoryBuild, identityBuild] = await Promise.all([
  artifact("LaunchpadTokenFactory"),
  artifact("ProtectedLaunchIdentityRegistry"),
]);
const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 }),
});
assert.equal(await client.getChainId(), 4663, "RPC chain mismatch");

const deployer = getAddress(manifest.deployerAddress);
const safe = getAddress(manifest.roles.defaultAdmin);
const timelock = getAddress(manifest.roles.upgrader);
const tokenFactory = getAddress(manifest.launchpad.tokenFactory);
const protectedFactory = getAddress(manifest.protectedLaunch.launchFactory);
const identityRegistry = getAddress(manifest.protectedLaunch.identityRegistry);
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)",
  "function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable",
]);
const accessAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function setRole(bytes32,address,bool)",
]);
const tokenFactoryAbi = parseAbi([
  "function setProtectedFactory(address)",
  "function protectedFactory() view returns (address)",
]);
const uupsAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
const launchpadFactoryRole = keccak256(
  new TextEncoder().encode("ZKBLAST_PROTECTED_LAUNCHPAD_FACTORY_ROLE"),
);
const launchpadBinderRole = keccak256(
  new TextEncoder().encode("ZKBLAST_PROTECTED_LAUNCHPAD_BINDER_ROLE"),
);

const [block, nonce, balance, gasPrice, delay, tokenImplementation, identityImplementation] =
  await Promise.all([
    client.getBlockNumber(),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.getBalance({ address: deployer }),
    client.getGasPrice(),
    client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" }),
    client.getStorageAt({ address: tokenFactory, slot: implementationSlot }),
    client.getStorageAt({ address: identityRegistry, slot: implementationSlot }),
  ]);
assert.equal(delay, 300n, "Upgrade timelock must remain 5 minutes");
assert(tokenImplementation && identityImplementation, "Implementation slot is empty");
const newTokenFactoryImplementation = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
const newIdentityImplementation = getContractAddress({ from: deployer, nonce: BigInt(nonce + 1) });
const tokenUpgradeData = encodeFunctionData({
  abi: uupsAbi,
  functionName: "upgradeToAndCall",
  args: [newTokenFactoryImplementation, "0x"],
});
const identityUpgradeData = encodeFunctionData({
  abi: uupsAbi,
  functionName: "upgradeToAndCall",
  args: [newIdentityImplementation, "0x"],
});
const targets = [tokenFactory, identityRegistry] as const;
const values = [0n, 0n] as const;
const payloads = [tokenUpgradeData, identityUpgradeData] as const;
const salt = keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
  ["ZKBLAST_PROTECTED_LAUNCHPAD_BINDING_V1", tokenFactory, identityRegistry, newTokenFactoryImplementation, newIdentityImplementation],
));
const operationId = keccak256(encodeAbiParameters(
  [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }, { type: "bytes32" }],
  [targets, values, payloads, zeroHash, salt],
));
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
const setProtectedFactoryData = encodeFunctionData({
  abi: tokenFactoryAbi,
  functionName: "setProtectedFactory",
  args: [protectedFactory],
});
const authorizeFactoryData = encodeFunctionData({
  abi: accessAbi,
  functionName: "setRole",
  args: [launchpadFactoryRole, tokenFactory, true],
});
const authorizeBinderData = encodeFunctionData({
  abi: accessAbi,
  functionName: "setRole",
  args: [launchpadBinderRole, tokenFactory, true],
});
const [tokenDeploymentGas, identityDeploymentGas, factoryAuthorized, binderAuthorized] = await Promise.all([
  client.estimateGas({ account: deployer, data: tokenFactoryBuild.bytecode.object }),
  client.estimateGas({ account: deployer, data: identityBuild.bytecode.object }),
  client.readContract({ address: protectedFactory, abi: accessAbi, functionName: "hasRole", args: [launchpadFactoryRole, tokenFactory] }),
  client.readContract({ address: identityRegistry, abi: accessAbi, functionName: "hasRole", args: [launchpadBinderRole, tokenFactory] }),
]);
const safeGasCeilingPerOperation = 500_000n;
const safeOperations = 5n;
const modeledGas = tokenDeploymentGas + identityDeploymentGas + safeGasCeilingPerOperation * safeOperations;
const feeCeiling = modeledGas * gasPrice * 2n;
const plan = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  broadcastAllowed: false,
  observedBlock: block.toString(),
  deployer,
  deployerNonce: nonce,
  deployerBalanceWei: balance.toString(),
  safe,
  timelock,
  delaySeconds: Number(delay),
  tokenFactory,
  protectedFactory,
  identityRegistry,
  currentTokenFactoryImplementation: getAddress(`0x${tokenImplementation.slice(-40)}`),
  currentIdentityImplementation: getAddress(`0x${identityImplementation.slice(-40)}`),
  newTokenFactoryImplementation,
  newIdentityImplementation,
  currentRoles: { factoryAuthorized, binderAuthorized },
  artifacts: {
    tokenFactoryCreationCodeHash: keccak256(tokenFactoryBuild.bytecode.object),
    tokenFactoryRuntimeCodeHash: keccak256(tokenFactoryBuild.deployedBytecode.object),
    identityCreationCodeHash: keccak256(identityBuild.bytecode.object),
    identityRuntimeCodeHash: keccak256(identityBuild.deployedBytecode.object),
  },
  governance: {
    predecessor: zeroHash,
    salt,
    operationId,
    scheduleData,
    executeData,
    setProtectedFactoryData,
    authorizeFactoryData,
    authorizeBinderData,
  },
  sequence: [
    "deploy-token-factory-implementation",
    "deploy-identity-registry-implementation",
    "safe-schedule-batch-upgrade",
    "wait-300-seconds",
    "safe-execute-batch-upgrade",
    "safe-configure-protected-factory",
    "safe-authorize-token-factory-on-protected-factory",
    "safe-authorize-token-factory-as-identity-binder",
    "verify-onchain",
  ],
  gas: {
    sampledGasPriceWei: gasPrice.toString(),
    tokenFactoryDeployment: tokenDeploymentGas.toString(),
    identityDeployment: identityDeploymentGas.toString(),
    safeGasCeilingPerOperation: safeGasCeilingPerOperation.toString(),
    modeledTotal: modeledGas.toString(),
    feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(root, "deployments/mainnet/protected-launchpad-binding-plan.json");
await writeFile(output, serialized);
console.log(JSON.stringify({
  observedBlock: plan.observedBlock,
  deployerNonce: nonce,
  deployerBalanceEth: formatEther(balance),
  delaySeconds: plan.delaySeconds,
  newTokenFactoryImplementation,
  newIdentityImplementation,
  factoryAuthorized,
  binderAuthorized,
  modeledGas: plan.gas.modeledTotal,
  feeCeilingEth: plan.gas.feeCeilingEth,
  planSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
  output,
}));
