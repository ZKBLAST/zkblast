import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  stringToHex,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Plan = Readonly<{
  planSha256: string;
  chainId: 4663;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  startingNonce: number;
  deployment: Readonly<{
    predictedContractAddress: Address;
    data: Hex;
  }>;
  upgrade: Readonly<{
    target: Address;
    implementation: Address;
    data: Hex;
    timelockDelaySeconds: number;
  }>;
  recoveryAssertions: Readonly<{ identityRegistry: Address }>;
}>;
type Artifact = Readonly<{ abi: Abi; deployedBytecode: { object: Hex } }>;

const expectedPlanHash =
  "79152d2146e63cb4066def711009644a2d7cc5333ea334f7ee8fce7eee48a5a2";
const cap = parseEther("0.00015");
const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/protected-launch/storage-layout-recovery-plan.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
assert.equal(plan.planSha256, expectedPlanHash, "RECOVERY_PLAN_HASH_MISMATCH");
assert.equal(plan.chainId, 4663, "RECOVERY_CHAIN_MISMATCH");
assert.equal(plan.upgrade.timelockDelaySeconds, 300, "TIMELOCK_DELAY_MISMATCH");

const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(
  privateKey && /^0x[\da-f]{64}$/iu.test(privateKey),
  "DEPLOYER_PRIVATE_KEY_INVALID",
);
const deployer = privateKeyToAccount(privateKey as Hex);
assert.equal(
  deployer.address,
  getAddress(plan.deployer),
  "DEPLOYER_ADDRESS_MISMATCH",
);

const rpcCandidates = [
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim()),
  "https://robinhood.drpc.org",
  "https://robinhood-rpc.publicnode.com",
].filter((value): value is string => Boolean(value));
let rpcUrl = "";
for (const candidate of new Set(rpcCandidates)) {
  const probe = createPublicClient({
    transport: http(candidate, { retryCount: 0, timeout: 12_000 }),
  });
  try {
    if ((await probe.getChainId()) === plan.chainId) {
      rpcUrl = candidate;
      break;
    }
  } catch {
    // Continue with the next configured/public RPC.
  }
}
assert(rpcUrl, "NO_HEALTHY_MAINNET_RPC");
const chain = defineChain({
  id: plan.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const transport = http(rpcUrl, { retryCount: 1, timeout: 20_000 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({
  account: deployer,
  chain,
  transport,
});
const artifact = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/contracts/out-hyperevm/ProtectedLaunchFactory.sol/ProtectedLaunchFactory.json",
    ),
    "utf8",
  ),
) as Artifact;

const pendingNonce = await publicClient.getTransactionCount({
  address: deployer.address,
  blockTag: "pending",
});
assert.equal(pendingNonce, plan.startingNonce, "DEPLOYER_NONCE_DRIFT");
const existingImplementationCode = await publicClient.getCode({
  address: plan.deployment.predictedContractAddress,
});
assert(
  !existingImplementationCode || existingImplementationCode === "0x",
  "RECOVERY_IMPLEMENTATION_ALREADY_DEPLOYED",
);

const receipts: TransactionReceipt[] = [];
const deploymentHash = await walletClient.sendTransaction({
  account: deployer,
  data: plan.deployment.data,
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentHash,
});
assert.equal(
  deploymentReceipt.status,
  "success",
  "IMPLEMENTATION_DEPLOYMENT_FAILED",
);
assert.equal(
  getAddress(deploymentReceipt.contractAddress!),
  getAddress(plan.deployment.predictedContractAddress),
  "IMPLEMENTATION_ADDRESS_MISMATCH",
);
receipts.push(deploymentReceipt);

const timelockAbi = parseAbi([
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable",
  "function hashOperation(address,uint256,bytes,bytes32,bytes32) view returns (bytes32)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationDone(bytes32) view returns (bool)",
]);
const salt = keccak256(
  stringToHex(`protected-factory-recovery:${plan.planSha256}`),
);
const operation = [
  plan.upgrade.target,
  0n,
  plan.upgrade.data,
  zeroHash,
  salt,
] as const;
const operationId = await publicClient.readContract({
  address: plan.upgrader,
  abi: timelockAbi,
  functionName: "hashOperation",
  args: operation,
});
const relaySafe = async (data: Hex) => {
  const prepared = await prepareSafeOperation(publicClient, {
    chainId: plan.chainId,
    safe: plan.governance,
    to: plan.upgrader,
    data,
    relayer: deployer,
  });
  const hash = await walletClient.sendTransaction({
    account: deployer,
    to: prepared.to,
    data: prepared.data,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", "SAFE_OPERATION_FAILED");
  receipts.push(receipt);
};

let readyAt = await publicClient.readContract({
  address: plan.upgrader,
  abi: timelockAbi,
  functionName: "getTimestamp",
  args: [operationId],
});
if (readyAt === 0n) {
  await relaySafe(
    encodeFunctionData({
      abi: timelockAbi,
      functionName: "schedule",
      args: [...operation, BigInt(plan.upgrade.timelockDelaySeconds)],
    }),
  );
  readyAt = await publicClient.readContract({
    address: plan.upgrader,
    abi: timelockAbi,
    functionName: "getTimestamp",
    args: [operationId],
  });
}
while ((await publicClient.getBlock()).timestamp < readyAt) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
if (
  !(await publicClient.readContract({
    address: plan.upgrader,
    abi: timelockAbi,
    functionName: "isOperationDone",
    args: [operationId],
  }))
) {
  await relaySafe(
    encodeFunctionData({
      abi: timelockAbi,
      functionName: "execute",
      args: operation,
    }),
  );
}

const [identityRegistry, implementationSlot] = await Promise.all([
  publicClient.readContract({
    address: plan.upgrade.target,
    abi: artifact.abi,
    functionName: "identityRegistry",
  }),
  publicClient.getStorageAt({
    address: plan.upgrade.target,
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  }),
]);
assert.equal(
  getAddress(identityRegistry as Address),
  getAddress(plan.recoveryAssertions.identityRegistry),
  "IDENTITY_REGISTRY_RECOVERY_FAILED",
);
assert(
  implementationSlot &&
    getAddress(`0x${implementationSlot.slice(-40)}`) ===
      getAddress(plan.upgrade.implementation),
  "PROXY_IMPLEMENTATION_MISMATCH",
);
const totalFee = receipts.reduce(
  (sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice,
  0n,
);
assert(totalFee <= cap, "RECOVERY_FEE_CAP_EXCEEDED");
const output = {
  schemaVersion: 1,
  planSha256: plan.planSha256,
  implementation: plan.upgrade.implementation,
  operationId,
  totalFeeWei: totalFee.toString(),
  totalFeeEth: formatEther(totalFee),
  capEth: formatEther(cap),
  transactions: receipts.map((receipt) => receipt.transactionHash),
  assertions: {
    implementationRecovered: true,
    identityRegistryRecovered: true,
  },
};
await writeFile(
  path.join(
    root,
    "deployments/mainnet/protected-launch/storage-layout-recovery-broadcast.json",
  ),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output));
