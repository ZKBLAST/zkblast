import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatEther } from "viem";

type GasReceipt = Readonly<{ gasUsed: string }>;

const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async <T>(relativePath: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as T;

const robinhoodManifest = await readJson<{
  contracts: Record<
    string,
    {
      transactions: {
        implementationDeployment?: GasReceipt;
        proxyDeploymentAndInitialization?: GasReceipt | null;
        configuration?: GasReceipt[];
      };
    }
  >;
}>("deployments/mainnet/manifest.json");
const dbcSimulation = await readJson<{ totalGasUsed: string }>(
  "deployments/mainnet/dbc-v1-simulation.json",
);
const launchpadSimulation = await readJson<{
  gas: { total: string };
}>("deployments/mainnet/launchpad-v1-simulation.json");
const hyperEvmPreflight = await readJson<{
  chain: { chainId: number; gasPriceWei: string };
  governancePlan: { estimatedGas: string };
}>("deployments/hyperevm-mainnet/preflight.json");
const sequentialSimulation = await readJson<{ totalGasUsed: string }>(
  "deployments/hyperevm-mainnet/sequential-simulation.json",
);

if (hyperEvmPreflight.chain.chainId !== 999) {
  throw new Error("HYPEREVM_MAINNET_PREFLIGHT_REQUIRED");
}

const receiptGas = (contractName: string): bigint => {
  const contract = robinhoodManifest.contracts[contractName];
  if (!contract) throw new Error(`REFERENCE_CONTRACT_MISSING:${contractName}`);
  const transactions = [
    contract.transactions.implementationDeployment,
    contract.transactions.proxyDeploymentAndInitialization,
    ...(contract.transactions.configuration ?? []),
  ].filter((value): value is GasReceipt => Boolean(value));
  return transactions.reduce((total, receipt) => total + BigInt(receipt.gasUsed), 0n);
};

const components = [
  {
    name: "governanceTimelock",
    gas: BigInt(hyperEvmPreflight.governancePlan.estimatedGas),
    evidence: "chain-999 eth_estimateGas",
  },
  {
    name: "poolCore",
    gas: ["PoolRegistry", "PoolFactory", "SwapRouter", "PositionManager", "PoolQuoter"]
      .map(receiptGas)
      .reduce((total, gas) => total + gas, 0n),
    evidence: "same-artifact Robinhood mainnet receipts",
  },
  {
    name: "dbcV1",
    gas: BigInt(dbcSimulation.totalGasUsed),
    evidence: "focused full DBC fork simulation",
  },
  {
    name: "launchpadV1",
    gas: BigInt(launchpadSimulation.gas.total),
    evidence: "focused full launchpad fork simulation",
  },
  {
    name: "graduationAdapterRegistryAndProxy",
    gas: 1_750_000n,
    evidence: "conservative bytecode-deposit plus proxy/initializer allowance",
  },
  {
    name: "chainSpecificConfigurationContingency",
    gas: 2_000_000n,
    evidence: "reserved until exact chain-999 initializer/configuration simulation",
  },
] as const;

const estimatedGas = components.reduce((total, component) => total + component.gas, 0n);
const simulatedGas = BigInt(sequentialSimulation.totalGasUsed);
const planningGas = simulatedGas > estimatedGas ? simulatedGas : estimatedGas;
const observedGasPriceWei = BigInt(hyperEvmPreflight.chain.gasPriceWei);
const planningGasPriceWei = observedGasPriceWei * 2n;
const gasWithExecutionBuffer = (planningGas * 125n + 99n) / 100n;
const estimatedAtObservedPriceWei = simulatedGas * observedGasPriceWei;
const recommendedFundingWei = gasWithExecutionBuffer * planningGasPriceWei;
const minimumPracticalFundingWei = recommendedFundingWei + 5_000_000_000_000_000n;

const report = {
      schemaVersion: 1,
      chainId: 999,
      method: "same-artifact receipts plus focused simulations and conservative allowances",
      components: components.map((component) => ({
        ...component,
        gas: component.gas.toString(),
      })),
      estimatedGas: estimatedGas.toString(),
      sequentialSimulationGas: simulatedGas.toString(),
      planningGas: planningGas.toString(),
      gasWith25PercentExecutionBuffer: gasWithExecutionBuffer.toString(),
      observedGasPriceWei: observedGasPriceWei.toString(),
      planningGasPriceWei: planningGasPriceWei.toString(),
      estimatedAtObservedPriceHype: formatEther(estimatedAtObservedPriceWei),
      recommendedGasBudgetHype: formatEther(recommendedFundingWei),
      minimumPracticalWalletFundingHype: formatEther(minimumPracticalFundingWei),
      limitations: [
        "This is not a broadcast approval or an exact chain-999 transaction plan.",
        "Pool-core gas uses identical-artifact Robinhood receipts until sequential chain-999 simulation exists.",
        "The practical wallet amount includes 0.005 HYPE beyond the buffered gas budget for retries and canary acceptance.",
      ],
    };
const serialized = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(
  path.join(root, "deployments/hyperevm-mainnet/funding-estimate.json"),
  serialized,
  { mode: 0o644 },
);
console.log(serialized);
