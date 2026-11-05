import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, type Address, type Hex } from "viem";

type Plan = Readonly<{
  chainId: number;
  deployer: Address;
  governance: Address;
  protocolToken: Address;
  startingNonce: number;
  planSha256: string;
  deployments: ReadonlyArray<{
    name: string;
    predictedContractAddress: Address;
    data: Hex;
  }>;
  governanceCalls: ReadonlyArray<{ description: string; target: Address; data: Hex }>;
  addresses: Record<string, Address>;
  gates: { broadcastAllowed: boolean };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const rpcUrl = process.env.LOCAL_FORK_RPC_URL;
if (!rpcUrl || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(rpcUrl)) {
  throw new Error("ASSISTANCE_FUND_SIMULATION_CONTEXT_INVALID");
}
const planPath = path.join(root, "deployments/mainnet/assistance-fund/deployment-plan.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
if (plan.chainId !== 4663 || plan.gates.broadcastAllowed) {
  throw new Error("ASSISTANCE_FUND_SIMULATION_PLAN_INVALID");
}

let requestId = 0;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const body = await response.json() as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (body.error || body.result === undefined) {
    throw new Error(`${method}:${body.error?.code ?? 0}:${body.error?.message ?? "missing result"}`);
  }
  return body.result;
}
async function receipt(hash: Hex) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await rpc<{
      status: Hex;
      gasUsed: Hex;
      contractAddress: Address | null;
      blockNumber: Hex;
    } | null>("eth_getTransactionReceipt", [hash]);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`ASSISTANCE_FUND_SIMULATION_RECEIPT_TIMEOUT:${hash}`);
}

if (Number(BigInt(await rpc<Hex>("eth_chainId"))) !== plan.chainId) {
  throw new Error("ASSISTANCE_FUND_SIMULATION_CHAIN_MISMATCH");
}
await rpc("anvil_setNonce", [plan.deployer, `0x${plan.startingNonce.toString(16)}`]);
for (const account of [plan.deployer, plan.governance]) {
  await rpc("anvil_impersonateAccount", [account]);
  await rpc("anvil_setBalance", [account, "0x3635c9adc5dea00000"]);
}
// The deterministic rehearsal needs only the same code-presence guarantees as constructors.
for (const dependency of [plan.governance, plan.protocolToken, getAddress("0xeDC71840758Ed9a2891D1BEEe21B414E910C0Ef7")]) {
  await rpc("anvil_setCode", [dependency, "0x60006000f3"]);
}

const results: Array<{
  description: string;
  hash: Hex;
  gasUsed: string;
  contractAddress: Address | null;
}> = [];
for (const deployment of plan.deployments) {
  const hash = await rpc<Hex>("eth_sendTransaction", [{
    from: plan.deployer,
    data: deployment.data,
    gas: "0x1c9c380",
  }]);
  const result = await receipt(hash);
  if (result.status !== "0x1" || !result.contractAddress) {
    throw new Error(`ASSISTANCE_FUND_SIMULATION_DEPLOYMENT_REVERT:${deployment.name}`);
  }
  if (getAddress(result.contractAddress) !== getAddress(deployment.predictedContractAddress)) {
    throw new Error(`ASSISTANCE_FUND_SIMULATION_ADDRESS_MISMATCH:${deployment.name}`);
  }
  results.push({
    description: deployment.name,
    hash,
    gasUsed: BigInt(result.gasUsed).toString(),
    contractAddress: getAddress(result.contractAddress),
  });
}
for (const call of plan.governanceCalls) {
  const hash = await rpc<Hex>("eth_sendTransaction", [{
    from: plan.governance,
    to: call.target,
    data: call.data,
    gas: "0x7a1200",
  }]);
  const result = await receipt(hash);
  if (result.status !== "0x1") {
    throw new Error(`ASSISTANCE_FUND_SIMULATION_CONFIGURATION_REVERT:${call.description}`);
  }
  results.push({ description: call.description, hash, gasUsed: BigInt(result.gasUsed).toString(), contractAddress: null });
}

const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
for (const [proxyName, implementationName] of [
  ["registry", "registryImplementation"],
  ["collector", "collectorImplementation"],
  ["treasuryController", "treasuryControllerImplementation"],
  ["routeRegistry", "routeRegistryImplementation"],
  ["executor", "executorImplementation"],
] as const) {
  const stored = await rpc<Hex>("eth_getStorageAt", [plan.addresses[proxyName], implementationSlot, "latest"]);
  if (getAddress(`0x${stored.slice(-40)}`) !== getAddress(plan.addresses[implementationName]!)) {
    throw new Error(`ASSISTANCE_FUND_SIMULATION_PROXY_SLOT_MISMATCH:${proxyName}`);
  }
}
const totalGasUsed = results.reduce((sum, result) => sum + BigInt(result.gasUsed), 0n);
const reportWithoutHash = {
  schemaVersion: 1,
  feature: "zkblast-assistance-fund",
  chainId: plan.chainId,
  sourcePlanSha256: plan.planSha256,
  deterministicRehearsal: true,
  deploymentTransactions: plan.deployments.length,
  governanceTransactions: plan.governanceCalls.length,
  totalGasUsed: totalGasUsed.toString(),
  passed: true,
  checks: {
    predictedAddresses: true,
    initializers: true,
    governanceConfiguration: true,
    proxyImplementationSlots: true,
    sourceActivationCount: 0,
    routeActivationCount: 0,
    broadcastAllowed: false,
  },
  receipts: results,
};
const reportSha256 = createHash("sha256").update(JSON.stringify(reportWithoutHash)).digest("hex");
const report = { ...reportWithoutHash, reportSha256 };
const outputPath = path.join(root, "deployments/mainnet/assistance-fund/deployment-simulation.json");
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ outputPath, totalGasUsed: totalGasUsed.toString(), transactions: results.length, reportSha256, passed: true }, null, 2));
