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
  parseAbi,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: unknown;
}>;

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const artifactPath = path.resolve(
  directory,
  "../out/ZKBlastTimelock.sol/ZKBlastTimelock.json",
);
const outputPath = path.resolve(root, "deployments/mainnet/governance.json");
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw new Error(message);
};

assert(required("APP_ENV") === "mainnet", "Mainnet environment required");
assert(Number(required("CHAIN_ID")) === 4663, "Chain 4663 required");
assert(
  process.env.CONFIRM_MAINNET_GOVERNANCE_DEPLOYMENT ===
    "DEPLOY_ZKBLAST_MAINNET_GOVERNANCE",
  "Explicit mainnet governance deployment confirmation required",
);
const minimumDelay = BigInt(required("MIN_TIMELOCK_DELAY_SECONDS"));
assert(minimumDelay >= 300n, "Timelock delay must be at least 5 minutes");
const governance = getAddress(required("GOVERNANCE_MULTISIG_ADDRESS"));
const key = required("DEPLOYER_PRIVATE_KEY") as Hex;
assert(/^0x[\da-f]{64}$/iu.test(key), "Invalid deployer key");
const account = privateKeyToAccount(key);
const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: 4663,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
assert((await client.getChainId()) === 4663, "RPC chain mismatch");
assert(
  (await client.getBytecode({ address: governance })) !== undefined,
  "Governance has no code",
);

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);
const [owners, threshold] = await Promise.all([
  client.readContract({
    address: governance,
    abi: safeAbi,
    functionName: "getOwners",
  }),
  client.readContract({
    address: governance,
    abi: safeAbi,
    functionName: "getThreshold",
  }),
]);
assert(owners.length >= 2, "Governance Safe requires at least two owners");
assert(
  threshold >= 2n && threshold <= BigInt(owners.length),
  "Unsafe Safe threshold",
);
assert(
  (await client.getBalance({ address: account.address })) > 0n,
  "Deployer has no gas",
);

const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [minimumDelay, governance],
  account,
});
const receipt = await client.waitForTransactionReceipt({
  hash,
  confirmations: 1,
});
assert(
  receipt.status === "success" && receipt.contractAddress,
  "Timelock deployment failed",
);
const timelock = getAddress(receipt.contractAddress);
const deployedCode = await client.getBytecode({ address: timelock });
assert(deployedCode && deployedCode !== "0x", "Timelock runtime missing");
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const delay = await client.readContract({
  address: timelock,
  abi: timelockAbi,
  functionName: "getMinDelay",
});
assert(delay === minimumDelay, "Timelock delay verification failed");
for (const functionName of [
  "PROPOSER_ROLE",
  "EXECUTOR_ROLE",
  "CANCELLER_ROLE",
] as const) {
  const role = await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName,
  });
  assert(
    await client.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [role, governance],
    }),
    `${functionName} verification failed`,
  );
}

const gasUsed = receipt.gasUsed;
const evidence = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "mainnet",
  chainId: 4663,
  deployedAt: new Date().toISOString(),
  deployerAddress: account.address,
  governanceMultisigAddress: governance,
  governanceOwnerCount: owners.length,
  governanceThreshold: threshold.toString(),
  timelockAddress: timelock,
  minimumDelaySeconds: minimumDelay.toString(),
  artifactCreationBytecodeHash: keccak256(artifact.bytecode.object),
  deployedRuntimeBytecodeHash: keccak256(deployedCode),
  transaction: {
    hash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  },
};
await mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);
console.log(`Mainnet timelock deployed: ${timelock}`);
