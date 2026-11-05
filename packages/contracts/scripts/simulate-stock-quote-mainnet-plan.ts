import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";

type Plan = Readonly<{
  planSha256: string;
  chainId: 4663;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  startingNonce: number;
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
const planPath = path.join(root, "deployments/mainnet/stock-quotes/deployment-plan.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
const rpcUrl = process.env.STOCK_QUOTE_SIMULATION_RPC ?? "http://127.0.0.1:18546";
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== plan.chainId) throw new Error("STOCK_QUOTE_SIMULATION_CHAIN_MISMATCH");

async function request(method: string, params: readonly unknown[]) {
  return client.request({ method: method as never, params: params as never });
}
const actors = [getAddress(plan.deployer), getAddress(plan.governance), getAddress(plan.upgrader)];
for (const actor of actors) {
  await request("anvil_impersonateAccount", [actor]);
  // Fork-only balance. Robinhood gas-price units can be large even when the
  // real native fee is small; this value is never used outside local Anvil.
  await request("anvil_setBalance", [actor, "0x0c9f2c9cd04674edea40000000"]);
}
const receipts: Array<Readonly<{
  kind: "deployment" | "configuration";
  name: string;
  transactionHash: Hex;
  gasUsed: string;
  status: string;
}>> = [];
let totalGasUsed = 0n;
for (const deployment of plan.deployments) {
  const transactionHash = await request("eth_sendTransaction", [{
    from: plan.deployer,
    data: deployment.data,
    nonce: `0x${deployment.nonce.toString(16)}`,
  }]) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success" || getAddress(receipt.contractAddress!) !== getAddress(deployment.predictedContractAddress)) {
    throw new Error(`STOCK_QUOTE_DEPLOYMENT_SIMULATION_FAILED:${deployment.name}`);
  }
  totalGasUsed += receipt.gasUsed;
  receipts.push({ kind: "deployment", name: deployment.name, transactionHash, gasUsed: receipt.gasUsed.toString(), status: receipt.status });
}
for (const call of plan.calls) {
  const from = call.actor === "governance" ? plan.governance : plan.upgrader;
  const transactionHash = await request("eth_sendTransaction", [{
    from,
    to: call.target,
    data: call.data,
  }]) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") throw new Error(`STOCK_QUOTE_CONFIGURATION_SIMULATION_FAILED:${call.description}`);
  totalGasUsed += receipt.gasUsed;
  receipts.push({ kind: "configuration", name: call.description, transactionHash, gasUsed: receipt.gasUsed.toString(), status: receipt.status });
}

const assetRegistry = getAddress(plan.addresses.assetRegistry!);
const oracleGuard = getAddress(plan.addresses.oracleGuard!);
const destinationRegistry = getAddress(plan.addresses.destinationRegistry!);
const managerRegistry = await client.readContract({
  address: getAddress("0xE83203279e4e8Db4Aa747213aC28260418Ff2E83"),
  abi: [{ type: "function", name: "stockQuoteDestinationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
  functionName: "stockQuoteDestinationRegistry",
});
const quoteGuard = await client.readContract({
  address: getAddress("0x98D8546bb60d4d5fF791fB6b904A611691D86beF"),
  abi: [{ type: "function", name: "quoteExecutionGuard", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }],
  functionName: "quoteExecutionGuard",
  args: [plan.canaryAsset],
});
const output = {
  schemaVersion: 1,
  planSha256: plan.planSha256,
  simulatedChainId: plan.chainId,
  simulatedAt: new Date().toISOString(),
  transactions: receipts.length,
  totalGasUsed: totalGasUsed.toString(),
  addresses: { assetRegistry, oracleGuard, destinationRegistry },
  assertions: {
    managerDestinationRegistryBound: getAddress(managerRegistry) === destinationRegistry,
    canaryExecutionGuardBound: getAddress(quoteGuard) === oracleGuard,
    quoteTradingEnabled: false,
    graduationEnabled: false,
    dammEnabled: false,
    dlmmEnabled: false,
  },
  receipts,
};
if (!output.assertions.managerDestinationRegistryBound || !output.assertions.canaryExecutionGuardBound) {
  throw new Error("STOCK_QUOTE_SIMULATION_ASSERTION_FAILED");
}
await writeFile(
  path.join(root, "deployments/mainnet/stock-quotes/deployment-simulation.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify({
  planSha256: output.planSha256,
  transactions: output.transactions,
  totalGasUsed: output.totalGasUsed,
  assertions: output.assertions,
}, null, 2));
