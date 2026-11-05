import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";

type Plan = Readonly<{
  planSha256: string;
  chainId: 4663;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  deployments: readonly Readonly<{
    name: string;
    nonce: number;
    predictedContractAddress: Address;
    data: Hex;
  }>[];
  calls: readonly Readonly<{
    actor: "governance" | "upgrader";
    description: string;
    target: Address;
    data: Hex;
  }>[];
  addresses: Readonly<Record<string, Address>>;
  canaryAsset: Address;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/policy-receipts-upgrade-plan.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
const rpcUrl = process.env.STOCK_QUOTE_SIMULATION_RPC ?? "http://127.0.0.1:18546";
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== plan.chainId) throw new Error("SIMULATION_CHAIN_MISMATCH");
async function request(method: string, params: readonly unknown[]) {
  return client.request({ method: method as never, params: params as never });
}
for (const actor of [plan.deployer, plan.governance, plan.upgrader]) {
  await request("anvil_impersonateAccount", [actor]);
  await request("anvil_setBalance", [actor, "0x0c9f2c9cd04674edea40000000"]);
}
const receipts: Array<Readonly<{
  kind: "deployment" | "configuration";
  name: string;
  transactionHash: Hex;
  gasUsed: string;
}>> = [];
let totalGasUsed = 0n;
for (const deployment of plan.deployments) {
  const hash = (await request("eth_sendTransaction", [
    {
      from: plan.deployer,
      data: deployment.data,
      nonce: `0x${deployment.nonce.toString(16)}`,
    },
  ])) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (
    receipt.status !== "success" ||
    !receipt.contractAddress ||
    getAddress(receipt.contractAddress) !== getAddress(deployment.predictedContractAddress)
  ) {
    throw new Error(`DEPLOYMENT_SIMULATION_FAILED:${deployment.name}`);
  }
  totalGasUsed += receipt.gasUsed;
  receipts.push({
    kind: "deployment",
    name: deployment.name,
    transactionHash: hash,
    gasUsed: receipt.gasUsed.toString(),
  });
}
for (const call of plan.calls) {
  const hash = (await request("eth_sendTransaction", [
    {
      from: call.actor === "governance" ? plan.governance : plan.upgrader,
      to: call.target,
      data: call.data,
    },
  ])) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`CONFIGURATION_SIMULATION_FAILED:${call.description}`);
  }
  totalGasUsed += receipt.gasUsed;
  receipts.push({
    kind: "configuration",
    name: call.description,
    transactionHash: hash,
    gasUsed: receipt.gasUsed.toString(),
  });
}
const factory = plan.calls.find((call) =>
  call.description.includes("Protected Launch Factory"),
)?.target;
const oracleGuard = plan.calls.find((call) =>
  call.description.includes("Oracle Guard"),
)?.target;
if (!factory || !oracleGuard) throw new Error("PLAN_TARGET_MISSING");
const [poolDeployer, poolFactory, policyIdentity] = await Promise.all([
  client.readContract({
    address: factory,
    abi: [
      { type: "function", name: "poolDeployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    ],
    functionName: "poolDeployer",
  }),
  client.readContract({
    address: getAddress(plan.addresses.protectedVirtualPoolDeployer!),
    abi: [
      { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    ],
    functionName: "factory",
  }),
  client.readContract({
    address: oracleGuard,
    abi: [
      {
        type: "function",
        name: "policyIdentity",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "bytes32" }],
      },
    ],
    functionName: "policyIdentity",
    args: [plan.canaryAsset],
  }),
]);
const expectedPoolDeployer = getAddress(plan.addresses.protectedVirtualPoolDeployer!);
const assertions = {
  poolDeployerInstalled: getAddress(poolDeployer) === expectedPoolDeployer,
  poolDeployerFactoryBound: getAddress(poolFactory) === getAddress(factory),
  policyIdentityAvailable: policyIdentity !== `0x${"00".repeat(32)}`,
  quoteTradingEnabled: false,
  graduationEnabled: false,
};
if (!Object.values(assertions).every((value) => value === true || value === false)) {
  throw new Error("INVALID_SIMULATION_ASSERTIONS");
}
if (
  !assertions.poolDeployerInstalled ||
  !assertions.poolDeployerFactoryBound ||
  !assertions.policyIdentityAvailable
) {
  throw new Error("POLICY_RECEIPT_SIMULATION_ASSERTION_FAILED");
}
const output = {
  schemaVersion: 1,
  planSha256: plan.planSha256,
  simulatedAt: new Date().toISOString(),
  transactions: receipts.length,
  totalGasUsed: totalGasUsed.toString(),
  assertions,
  receipts,
};
const outputPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/policy-receipts-upgrade-simulation.json",
);
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify(
    { outputPath, planSha256: plan.planSha256, totalGasUsed: output.totalGasUsed, assertions },
    null,
    2,
  ),
);
