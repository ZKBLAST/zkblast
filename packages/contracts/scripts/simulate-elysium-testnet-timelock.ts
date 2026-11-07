import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  encodeDeployData,
  getAddress,
  type Address,
  type Hex,
} from "viem";

type Receipt = Readonly<{
  blockNumber: Hex;
  contractAddress: Address | null;
  effectiveGasPrice: Hex;
  gasUsed: Hex;
  status: Hex;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const deploymentDirectory = path.join(root, "deployments/elysium-testnet");
const preflight = JSON.parse(
  await readFile(path.join(deploymentDirectory, "preflight.json"), "utf8"),
) as {
  chain: { chainId: number };
  deployer: { address: Address; pendingNonce: number };
  governancePlan: {
    deploymentNonce: number;
    minimumDelaySeconds: string;
    predictedTimelock: Address;
  };
  roles: { governance: Address };
};
const artifact = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/contracts/out-elysium/ZKBlastTimelock.sol/ZKBlastTimelock.json",
    ),
    "utf8",
  ),
) as { abi: readonly unknown[]; bytecode: { object: Hex } };

if (
  preflight.chain.chainId !== 99_801 ||
  preflight.deployer.pendingNonce !== 0 ||
  preflight.governancePlan.deploymentNonce !== 0
) {
  throw new Error("ELYSIUM_TIMELOCK_SIMULATION_CONTEXT_INVALID");
}

const rpcUrl = process.env.SIMULATION_RPC_URL ?? "http://127.0.0.1:18555";
let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (payload.error) {
    throw new Error(
      `${method}:${payload.error.code}:${payload.error.message}:${JSON.stringify(payload.error.data ?? null)}`,
    );
  }
  return payload.result as T;
}

if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== 99_801) {
  throw new Error("ELYSIUM_TIMELOCK_SIMULATION_CHAIN_INVALID");
}

const deployer = getAddress(preflight.deployer.address);
if (
  Number(
    BigInt(await rpc<Hex>("eth_getTransactionCount", [deployer, "pending"])),
  ) !== 0
) {
  throw new Error("ELYSIUM_TIMELOCK_SIMULATION_NONCE_INVALID");
}

await rpc("anvil_impersonateAccount", [deployer]);
await rpc("anvil_setBalance", [deployer, "0x8ac7230489e80000"]);
const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [
    BigInt(preflight.governancePlan.minimumDelaySeconds),
    getAddress(preflight.roles.governance),
  ],
});
const transaction = { from: deployer, data, nonce: "0x0" };
const estimatedGas = BigInt(await rpc<Hex>("eth_estimateGas", [transaction]));
const gasLimit = estimatedGas + 100_000n;
const hash = await rpc<Hex>("eth_sendTransaction", [
  { ...transaction, gas: `0x${gasLimit.toString(16)}` },
]);
let receipt: Receipt | null = null;
for (let attempt = 0; attempt < 30 && !receipt; attempt += 1) {
  receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [hash]);
  if (!receipt) await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!receipt || receipt.status !== "0x1") {
  throw new Error("ELYSIUM_TIMELOCK_SIMULATION_TRANSACTION_FAILED");
}
if (
  getAddress(receipt.contractAddress ?? "0x0000000000000000000000000000000000000000") !==
  getAddress(preflight.governancePlan.predictedTimelock)
) {
  throw new Error("ELYSIUM_TIMELOCK_SIMULATION_ADDRESS_MISMATCH");
}

const report = {
  schemaVersion: 1,
  chainId: 99_801,
  generatedAt: new Date().toISOString(),
  transactionCount: 1,
  nonce: 0,
  hash,
  predictedTimelock: preflight.governancePlan.predictedTimelock,
  estimatedGas: estimatedGas.toString(),
  gasLimit: gasLimit.toString(),
  gasUsed: BigInt(receipt.gasUsed).toString(),
  effectiveGasPrice: BigInt(receipt.effectiveGasPrice).toString(),
  blockNumber: BigInt(receipt.blockNumber).toString(),
  passed: true,
  broadcastAllowed: false,
};
await writeFile(
  path.join(deploymentDirectory, "timelock-deployment-simulation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(
  JSON.stringify(
    {
      predictedTimelock: report.predictedTimelock,
      gasUsed: report.gasUsed,
      passed: report.passed,
      broadcastAllowed: report.broadcastAllowed,
    },
    null,
    2,
  ),
);
