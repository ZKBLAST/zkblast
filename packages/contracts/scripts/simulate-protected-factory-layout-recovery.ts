import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Plan = Readonly<{
  planSha256: string;
  chainId: 4663;
  deployer: Address;
  upgrader: Address;
  deployment: Readonly<{
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
  }>;
  upgrade: Readonly<{ target: Address; implementation: Address; data: Hex }>;
  recoveryAssertions: Readonly<{ identityRegistry: Address }>;
}>;
type Artifact = Readonly<{ abi: Abi }>;

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(
  await readFile(
    path.join(
      root,
      "deployments/mainnet/protected-launch/storage-layout-recovery-plan.json",
    ),
    "utf8",
  ),
) as Plan;
const artifact = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/contracts/out-hyperevm/ProtectedLaunchFactory.sol/ProtectedLaunchFactory.json",
    ),
    "utf8",
  ),
) as Artifact;
const rpcUrl =
  process.env.PROTECTED_RECOVERY_SIMULATION_RPC ?? "http://127.0.0.1:18546";
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== plan.chainId)
  throw new Error("SIMULATION_CHAIN_MISMATCH");
const request = (method: string, params: readonly unknown[]) =>
  client.request({ method: method as never, params: params as never });
const rpcFailure = (error: unknown) => {
  const value = error as { shortMessage?: string; details?: string };
  return new Error(
    [value.shortMessage, value.details].filter(Boolean).join(": ") ||
      "RECOVERY_SIMULATION_RPC_FAILED",
  );
};
for (const actor of [plan.deployer, plan.upgrader]) {
  await request("anvil_impersonateAccount", [actor]);
  await request("anvil_setBalance", [actor, "0x1000000000000000000"]);
}
let deploymentHash: Hex;
try {
  deploymentHash = (await request("eth_sendTransaction", [
    {
      from: plan.deployer,
      data: plan.deployment.data,
      nonce: `0x${plan.deployment.nonce.toString(16)}`,
    },
  ])) as Hex;
} catch (error) {
  throw rpcFailure(error);
}
const deploymentReceipt = await client.waitForTransactionReceipt({
  hash: deploymentHash,
});
if (
  deploymentReceipt.status !== "success" ||
  getAddress(deploymentReceipt.contractAddress!) !==
    getAddress(plan.deployment.predictedContractAddress)
) {
  throw new Error("RECOVERY_IMPLEMENTATION_DEPLOYMENT_FAILED");
}
const upgradeHash = (await request("eth_sendTransaction", [
  {
    from: plan.upgrader,
    to: plan.upgrade.target,
    data: plan.upgrade.data,
  },
])) as Hex;
const upgradeReceipt = await client.waitForTransactionReceipt({
  hash: upgradeHash,
});
if (upgradeReceipt.status !== "success")
  throw new Error("RECOVERY_UPGRADE_FAILED");

const identityRegistry = await client.readContract({
  address: plan.upgrade.target,
  abi: artifact.abi,
  functionName: "identityRegistry",
});
if (
  getAddress(identityRegistry as Address) !==
  getAddress(plan.recoveryAssertions.identityRegistry)
) {
  throw new Error("IDENTITY_REGISTRY_NOT_RECOVERED");
}
const msft = getAddress("0xe93237C50D904957Cf27E7B1133b510C669c2e74");
const guard = await client.readContract({
  address: plan.upgrade.target,
  abi: artifact.abi,
  functionName: "quoteExecutionGuard",
  args: [msft],
});
if (
  getAddress(guard as Address) ===
  getAddress("0x0000000000000000000000000000000000000000")
) {
  throw new Error("STOCK_QUOTE_GUARD_NOT_PRESERVED");
}
const account = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
const createData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "createLaunch",
  args: [
    {
      templateId: 8n,
      policyId: 1n,
      salt: keccak256(
        stringToHex("zkblast-msft-dlmm-layout-recovery-simulation"),
      ),
      deadline: (await client.getBlock()).timestamp + 3_600n,
      name: "ZKBLAST MSFT DLMM Recovery Simulation",
      symbol: "ZKMSFTSIM",
      metadataURI: "ipfs://zkblast-layout-recovery-simulation",
      creatorTokenRecipient: account,
    },
  ],
});
await client.call({ account, to: plan.upgrade.target, data: createData });

const receipts = [deploymentReceipt, upgradeReceipt];
const totalGasUsed = receipts.reduce(
  (sum, receipt) => sum + receipt.gasUsed,
  0n,
);
const output = {
  schemaVersion: 1,
  planSha256: plan.planSha256,
  simulatedAt: new Date().toISOString(),
  forkBlock: (await client.getBlockNumber()).toString(),
  totalGasUsed: totalGasUsed.toString(),
  assertions: {
    implementationDeployed: true,
    identityRegistryRecovered: true,
    stockQuoteGuardPreserved: true,
    msftDlmmProtectedCreateCall: true,
    broadcast: false,
  },
  receipts: receipts.map((receipt) => ({
    transactionHash: receipt.transactionHash,
    gasUsed: receipt.gasUsed.toString(),
  })),
};
const outputPath = path.join(
  root,
  "deployments/mainnet/protected-launch/storage-layout-recovery-simulation.json",
);
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...output }));
