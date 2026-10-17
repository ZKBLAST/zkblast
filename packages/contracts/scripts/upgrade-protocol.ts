import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  type Abi,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function key(name: string): Hex {
  const value = required(name);
  if (!/^0x[\da-f]{64}$/iu.test(value)) throw new Error(`${name} is invalid`);
  return value as Hex;
}

function transactionRecord(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress
      ? getAddress(receipt.contractAddress)
      : null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success" as const,
  };
}

const environment = required("APP_ENV");
if (environment !== "testnet")
  throw new Error("This upgrade command is testnet-only");
const contractName = required("UPGRADE_CONTRACT_NAME");
if (contractName !== "PoolFactory")
  throw new Error("Unsupported upgrade target");
const chainId = Number(required("CHAIN_ID"));
const rpcUrl = required("RPC_URL");
const manifestPath = path.resolve(root, required("DEPLOYMENT_MANIFEST_PATH"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as any;
const deployment = manifest.contracts?.[contractName];
if (!deployment?.proxyAddress || !deployment?.implementationAddress) {
  throw new Error(`${contractName} deployment is missing`);
}

const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
const upgrader = privateKeyToAccount(key("UPGRADER_PRIVATE_KEY"));
if (getAddress(upgrader.address) !== getAddress(manifest.upgraderAddress)) {
  throw new Error(
    "UPGRADER_PRIVATE_KEY does not match manifest upgraderAddress",
  );
}
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const [deployerBalance, upgraderBalance] = await Promise.all([
  client.getBalance({ address: deployer.address }),
  client.getBalance({ address: upgrader.address }),
]);
if (deployerBalance === 0n) throw new Error("Deployer has zero native balance");
if (upgraderBalance === 0n)
  throw new Error(`Upgrader ${upgrader.address} has zero native balance`);

const artifact = JSON.parse(
  await readFile(
    path.resolve(
      root,
      `packages/contracts/out/${contractName}.sol/${contractName}.json`,
    ),
    "utf8",
  ),
) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const deployerClient = createWalletClient({
  account: deployer,
  chain,
  transport: http(rpcUrl),
});
const implementationHash = await deployerClient.deployContract({
  account: deployer,
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
});
const implementationReceipt = await client.waitForTransactionReceipt({
  hash: implementationHash,
  confirmations: 1,
});
if (
  implementationReceipt.status !== "success" ||
  !implementationReceipt.contractAddress
) {
  throw new Error("Implementation deployment failed");
}
const newImplementation = getAddress(implementationReceipt.contractAddress);

const upgraderClient = createWalletClient({
  account: upgrader,
  chain,
  transport: http(rpcUrl),
});
const upgradeHash = await upgraderClient.writeContract({
  account: upgrader,
  address: getAddress(deployment.proxyAddress),
  abi: artifact.abi,
  functionName: "upgradeToAndCall",
  args: [newImplementation, "0x"],
});
const upgradeReceipt = await client.waitForTransactionReceipt({
  hash: upgradeHash,
  confirmations: 1,
});
if (upgradeReceipt.status !== "success")
  throw new Error("Proxy upgrade failed");
const stored = await client.getStorageAt({
  address: getAddress(deployment.proxyAddress),
  slot: IMPLEMENTATION_SLOT,
});
if (!stored || getAddress(`0x${stored.slice(-40)}`) !== newImplementation) {
  throw new Error("Proxy implementation slot did not update");
}
const code = await client.getBytecode({ address: newImplementation });
if (!code) throw new Error("New implementation bytecode is missing");

const implementationTransaction = transactionRecord(implementationReceipt);
const proxyUpgrade = transactionRecord(upgradeReceipt);
deployment.upgrades ??= [];
deployment.upgrades.push({
  previousImplementationAddress: deployment.implementationAddress,
  newImplementationAddress: newImplementation,
  implementationDeployment: implementationTransaction,
  proxyUpgrade,
});
deployment.implementationAddress = newImplementation;
deployment.artifactBytecodeHash = keccak256(artifact.deployedBytecode.object);
deployment.deployedRuntimeBytecodeHash = keccak256(code);
deployment.verification = {
  implementation: "pending",
  proxy: "verified",
  urls: [],
};
manifest.totals.transactionCount += 2;
manifest.totals.gasUsed = (
  BigInt(manifest.totals.gasUsed) +
  BigInt(implementationTransaction.gasUsed) +
  BigInt(proxyUpgrade.gasUsed)
).toString();
manifest.totals.totalFeeWei = (
  BigInt(manifest.totals.totalFeeWei) +
  BigInt(implementationTransaction.totalFeeWei) +
  BigInt(proxyUpgrade.totalFeeWei)
).toString();
manifest.generatedAt = new Date().toISOString();
manifest.deploymentBlock = Number(upgradeReceipt.blockNumber);
manifest.deploymentBlockHash = upgradeReceipt.blockHash;

await mkdir(path.dirname(manifestPath), { recursive: true });
const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
await rename(temporaryPath, manifestPath);
console.log(`${contractName} upgraded: ${newImplementation}`);
console.log(`Implementation transaction: ${implementationHash as Hash}`);
console.log(`Proxy upgrade transaction: ${upgradeHash as Hash}`);
