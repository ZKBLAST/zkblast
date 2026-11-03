import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, keccak256, type Address, type Hex } from "viem";

type Plan = Readonly<{
  chainId: number;
  deployer: Address;
  governance: Address;
  startingNonce: number;
  nextDeployerNonce: number;
  planSha256: string;
  deployments: ReadonlyArray<{
    name: string;
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
    runtimeIdentity: {
      normalizedHash: Hex;
      immutableReferences: ReadonlyArray<{ start: number; length: number }>;
    } | null;
  }>;
  governanceCalls: ReadonlyArray<{
    description: string;
    target: Address;
    data: Hex;
  }>;
  addresses: Record<string, Address>;
  dependencies: { templateRegistry: Address; poolFactory: Address };
  gates: { broadcastAllowed: boolean };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const chainId = Number(process.env.CHAIN_ID);
const environment = process.env.APP_ENV;
const rpcUrl = process.env.LOCAL_FORK_RPC_URL;
const deterministicRehearsal = process.env.LOCAL_REHEARSAL_NO_FORK === "1";
if (
  !Number.isSafeInteger(chainId) ||
  chainId <= 0 ||
  (environment !== "mainnet" && environment !== "testnet") ||
  !rpcUrl ||
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(rpcUrl)
) {
  throw new Error("PROTECTED_LAUNCH_SIMULATION_CONTEXT_INVALID");
}
const localRpcUrl = rpcUrl;
const directory = chainId === 999 ? "hyperevm-mainnet" : environment;
const planPath = path.join(
  root,
  `deployments/${directory}/protected-launch/deployment-plan.json`,
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
if (plan.chainId !== chainId || plan.gates.broadcastAllowed) {
  throw new Error("PROTECTED_LAUNCH_SIMULATION_PLAN_INVALID");
}

let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(localRpcUrl, {
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

async function receipt(hash: Hex) {
  for (let attempt = 0; attempt < 100; ++attempt) {
    const value = await rpc<{
      status: Hex;
      gasUsed: Hex;
      contractAddress: Address | null;
      blockNumber: Hex;
    } | null>("eth_getTransactionReceipt", [hash]);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`PROTECTED_LAUNCH_SIMULATION_RECEIPT_TIMEOUT:${hash}`);
}

const forkChainId = Number(BigInt(await rpc<Hex>("eth_chainId")));
if (forkChainId !== chainId) throw new Error("PROTECTED_LAUNCH_SIMULATION_CHAIN_MISMATCH");
if (deterministicRehearsal) {
  await rpc("anvil_setNonce", [plan.deployer, `0x${plan.startingNonce.toString(16)}`]);
  await rpc("anvil_setCode", [
    plan.dependencies.templateRegistry,
    "0x60006000f3",
  ]);
}
const forkNonce = Number(
  BigInt(await rpc<Hex>("eth_getTransactionCount", [plan.deployer, "pending"])),
);
if (forkNonce !== plan.startingNonce) {
  throw new Error(`PROTECTED_LAUNCH_SIMULATION_NONCE_MISMATCH:${forkNonce}`);
}
for (const account of [plan.deployer, plan.governance]) {
  await rpc("anvil_impersonateAccount", [account]);
  await rpc("anvil_setBalance", [account, "0x3635c9adc5dea00000"]);
}

const results: Array<{
  description: string;
  hash: Hex;
  gasUsed: string;
  contractAddress: Address | null;
  blockNumber: string;
}> = [];
for (const item of plan.deployments) {
  const hash = await rpc<Hex>("eth_sendTransaction", [
    { from: plan.deployer, data: item.data, gas: "0x1c9c380" },
  ]);
  const result = await receipt(hash);
  if (result.status !== "0x1") throw new Error(`PROTECTED_LAUNCH_DEPLOYMENT_REVERT:${item.name}`);
  if (
    !result.contractAddress ||
    getAddress(result.contractAddress) !== getAddress(item.predictedContractAddress)
  ) {
    throw new Error(`PROTECTED_LAUNCH_PREDICTED_ADDRESS_MISMATCH:${item.name}`);
  }
  results.push({
    description: item.name,
    hash,
    gasUsed: BigInt(result.gasUsed).toString(),
    contractAddress: getAddress(result.contractAddress),
    blockNumber: BigInt(result.blockNumber).toString(),
  });
}
for (const call of plan.governanceCalls) {
  const hash = await rpc<Hex>("eth_sendTransaction", [
    {
      from: plan.governance,
      to: call.target,
      data: call.data,
      gas: "0x7a1200",
    },
  ]);
  const result = await receipt(hash);
  if (result.status !== "0x1") {
    throw new Error(`PROTECTED_LAUNCH_CONFIGURATION_REVERT:${call.description}`);
  }
  results.push({
    description: call.description,
    hash,
    gasUsed: BigInt(result.gasUsed).toString(),
    contractAddress: null,
    blockNumber: BigInt(result.blockNumber).toString(),
  });
}

for (const deployment of plan.deployments) {
  if (!deployment.runtimeIdentity) continue;
  const code = await rpc<Hex>("eth_getCode", [deployment.predictedContractAddress, "latest"]);
  const normalized = code.slice(2).split("");
  for (const reference of deployment.runtimeIdentity.immutableReferences) {
    normalized.fill("0", reference.start * 2, (reference.start + reference.length) * 2);
  }
  if (
    !code ||
    code === "0x" ||
    keccak256(`0x${normalized.join("")}` as Hex) !==
      deployment.runtimeIdentity.normalizedHash
  ) {
    throw new Error(`PROTECTED_LAUNCH_RUNTIME_HASH_MISMATCH:${deployment.name}`);
  }
}
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const proxyPairs = [
  ["policyRegistry", "policyRegistryImplementation"],
  ["lpEscrow", "lpEscrowImplementation"],
  ["identityRegistry", "identityRegistryImplementation"],
  ["factory", "factoryImplementation"],
  ["router", "routerImplementation"],
  ["graduationManager", "graduationManagerImplementation"],
] as const;
for (const [proxyName, implementationName] of proxyPairs) {
  const stored = await rpc<Hex>("eth_getStorageAt", [
    plan.addresses[proxyName],
    implementationSlot,
    "latest",
  ]);
  const resolved = getAddress(`0x${stored.slice(-40)}`);
  if (resolved !== getAddress(plan.addresses[implementationName]!)) {
    throw new Error(`PROTECTED_LAUNCH_IMPLEMENTATION_SLOT_MISMATCH:${proxyName}`);
  }
}
const totalGasUsed = results.reduce((total, item) => total + BigInt(item.gasUsed), 0n);
const reportWithoutHash = {
  schemaVersion: 1,
  chainId,
  sourcePlanSha256: plan.planSha256,
  referenceNonce: plan.startingNonce,
  deploymentTransactions: plan.deployments.length,
  governanceTransactions: plan.governanceCalls.length,
  totalGasUsed: totalGasUsed.toString(),
  passed: true,
  checks: {
    sequentialDeployment: true,
    predictedAddresses: true,
    governanceConfiguration: true,
    runtimeBytecodeHashes: true,
    proxyImplementationSlots: true,
    existingTemplateRegistryStubbed: deterministicRehearsal,
    privateKeysRead: false,
    broadcastAllowed: false,
  },
  receipts: results,
};
const reportSha256 = createHash("sha256")
  .update(JSON.stringify(reportWithoutHash))
  .digest("hex");
const report = { ...reportWithoutHash, reportSha256 };
const reportPath = path.join(
  root,
  `deployments/${directory}/protected-launch/deployment-simulation.json`,
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(
  JSON.stringify(
    {
      reportPath,
      transactionCount: results.length,
      totalGasUsed: report.totalGasUsed,
      reportSha256,
      passed: true,
      broadcastAllowed: false,
    },
    null,
    2,
  ),
);
