import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeSingletonDeployment,
} from "@safe-global/safe-deployments";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 4663;
const SAFE_VERSION = "1.4.1";
const CONFIRMATION = "DEPLOY_ZKBLAST_MAINNET_SAFE";

function failRedacted(): never {
  console.error("Safe deployment check failed; RPC details redacted");
  process.exit(1);
}

process.on("uncaughtException", failRedacted);
process.on("unhandledRejection", failRedacted);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function parseOwners(value: string): Address[] {
  const owners = value.split(",").map((owner) => getAddress(owner.trim()));
  invariant(owners.length >= 2, "Mainnet Safe requires at least two owners");
  invariant(
    new Set(owners.map((owner) => owner.toLowerCase())).size === owners.length,
    "Mainnet Safe owners must be unique",
  );
  invariant(!owners.includes(zeroAddress), "Safe owner must not be zero");
  return owners;
}

function deploymentAddress(
  deployment: ReturnType<typeof getSafeSingletonDeployment>,
  label: string,
): Address {
  invariant(deployment, `Official ${label} deployment is unavailable`);
  const address = deployment.networkAddresses[String(CHAIN_ID)];
  invariant(address, `Official ${label} is not registered on chain ${CHAIN_ID}`);
  return getAddress(address);
}

async function assertOfficialCode(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  expectedHash: Hex,
  label: string,
): Promise<Hex> {
  const code = await client.getBytecode({ address });
  invariant(code && code !== "0x", `${label} has no runtime code`);
  invariant(keccak256(code) === expectedHash, `${label} runtime hash mismatch`);
  return code;
}

invariant(required("APP_ENV") === "mainnet", "Mainnet environment required");
invariant(Number(required("CHAIN_ID")) === CHAIN_ID, "Chain 4663 required");
const owners = parseOwners(required("MAINNET_SAFE_OWNERS"));
const threshold = BigInt(required("MAINNET_SAFE_THRESHOLD"));
invariant(threshold >= 2n, "Mainnet Safe threshold must be at least two");
invariant(threshold <= BigInt(owners.length), "Threshold exceeds owner count");
const saltNonce = BigInt(required("MAINNET_SAFE_SALT_NONCE"));
invariant(saltNonce >= 0n, "MAINNET_SAFE_SALT_NONCE must not be negative");

const key = required("DEPLOYER_PRIVATE_KEY") as Hex;
invariant(/^0x[\da-f]{64}$/iu.test(key), "Invalid deployer key");
const account = privateKeyToAccount(key);
const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: CHAIN_ID,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
invariant((await client.getChainId()) === CHAIN_ID, "RPC chain mismatch");
invariant(
  (await client.getBalance({ address: account.address })) > 0n,
  "Deployer has no native gas",
);

const filter = { version: SAFE_VERSION, network: String(CHAIN_ID) };
const singletonDeployment = getSafeSingletonDeployment(filter);
const factoryDeployment = getProxyFactoryDeployment(filter);
const handlerDeployment = getCompatibilityFallbackHandlerDeployment(filter);
invariant(singletonDeployment, "Official Safe singleton deployment missing");
invariant(factoryDeployment, "Official Safe factory deployment missing");
invariant(handlerDeployment, "Official Safe fallback handler missing");
const singleton = deploymentAddress(singletonDeployment, "Safe singleton");
const factory = deploymentAddress(factoryDeployment, "Safe proxy factory");
const fallbackHandler = deploymentAddress(handlerDeployment, "fallback handler");
const canonicalHash = (deployment: typeof singletonDeployment): Hex => {
  const record = Object.values(deployment.deployments).find(
    (item) => item?.address.toLowerCase() === deployment.defaultAddress.toLowerCase(),
  );
  invariant(record, `Registry hash missing for ${deployment.contractName}`);
  return record.codeHash as Hex;
};
await Promise.all([
  assertOfficialCode(client, singleton, canonicalHash(singletonDeployment), "Safe singleton"),
  assertOfficialCode(client, factory, canonicalHash(factoryDeployment), "Safe proxy factory"),
  assertOfficialCode(client, fallbackHandler, canonicalHash(handlerDeployment), "Safe fallback handler"),
]);

const initializer = encodeFunctionData({
  abi: singletonDeployment.abi as Abi,
  functionName: "setup",
  args: [
    owners,
    threshold,
    zeroAddress,
    "0x",
    fallbackHandler,
    zeroAddress,
    0n,
    zeroAddress,
  ],
});
const simulation = await client.simulateContract({
  address: factory,
  abi: factoryDeployment.abi as Abi,
  functionName: "createProxyWithNonce",
  args: [singleton, initializer, saltNonce],
  account,
});
const predictedSafe = getAddress(simulation.result as Address);
const existingCode = await client.getBytecode({ address: predictedSafe });
invariant(!existingCode || existingCode === "0x", "Predicted Safe already exists");

console.log(`Official Safe version: ${SAFE_VERSION}`);
console.log(`Owner count: ${owners.length}`);
console.log(`Threshold: ${threshold}`);
console.log(`Predicted Safe: ${predictedSafe}`);
const estimatedGas = await client.estimateContractGas(simulation.request);
console.log(`Estimated gas: ${estimatedGas}`);

if (process.env.CONFIRM_MAINNET_SAFE_DEPLOYMENT !== CONFIRMATION) {
  console.log(`Simulation passed. Set CONFIRM_MAINNET_SAFE_DEPLOYMENT=${CONFIRMATION} to broadcast.`);
  process.exit(0);
}

const hash = await wallet.writeContract(simulation.request);
const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
invariant(receipt.status === "success", "Safe deployment transaction failed");
const [deployedCode, deployedOwners, deployedThreshold] = await Promise.all([
  client.getBytecode({ address: predictedSafe }),
  client.readContract({
    address: predictedSafe,
    abi: singletonDeployment.abi as Abi,
    functionName: "getOwners",
  }) as Promise<readonly Address[]>,
  client.readContract({
    address: predictedSafe,
    abi: singletonDeployment.abi as Abi,
    functionName: "getThreshold",
  }) as Promise<bigint>,
]);
invariant(deployedCode && deployedCode !== "0x", "Safe proxy runtime missing");
invariant(deployedThreshold === threshold, "Deployed Safe threshold mismatch");
invariant(
  deployedOwners.length === owners.length &&
    deployedOwners.every((owner, index) => owner === owners[index]),
  "Deployed Safe owners mismatch",
);

const evidence = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "mainnet",
  chainId: CHAIN_ID,
  deployedAt: new Date().toISOString(),
  safe: {
    address: predictedSafe,
    version: SAFE_VERSION,
    owners,
    threshold: threshold.toString(),
    saltNonce: saltNonce.toString(),
    singleton,
    proxyFactory: factory,
    fallbackHandler,
    runtimeBytecodeHash: keccak256(deployedCode),
  },
  deployerAddress: account.address,
  transaction: {
    hash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  },
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outputPath = path.resolve(root, "deployments/mainnet/safe.json");
await mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);
console.log(`Mainnet Safe deployed: ${predictedSafe}`);
