import { formatEther, type Address, type Hex, type PublicClient } from "viem";

export type GasStage = {
  stage: string;
  gasUsed: string;
  estimateGas: string;
  fundingAccount: Address;
};

export function summarizeUpgradeFees(
  stages: readonly GasStage[],
  gasPrice: bigint,
) {
  const gas = stages.reduce((sum, item) => sum + BigInt(item.estimateGas), 0n);
  const bufferedGas = (gas * 125n + 99n) / 100n;
  return {
    gasPriceWei: gasPrice.toString(),
    estimatedGas: gas.toString(),
    estimatedFeeETH: formatEther(gas * gasPrice),
    suggestedGasLimit: bufferedGas.toString(),
    suggestedGasPriceCapWei: (gasPrice * 2n).toString(),
    suggestedFeeCeilingETH: formatEther(bufferedGas * gasPrice * 2n),
    funding: [...new Set(stages.map((item) => item.fundingAccount))].map(
      (account) => {
        const accountGas = stages
          .filter((item) => item.fundingAccount === account)
          .reduce((sum, item) => sum + BigInt(item.estimateGas), 0n);
        return {
          account,
          estimatedFeeETH: formatEther(accountGas * gasPrice),
          suggestedFeeCeilingETH: formatEther(
            ((accountGas * 125n + 99n) / 100n) * gasPrice * 2n,
          ),
        };
      },
    ),
  };
}

/** Read-only live RPC estimates for creations; future-state calls retain fork estimates. */
export async function quoteFactoryUpgradeFees(
  live: PublicClient,
  stages: readonly GasStage[],
  creationData: { factory: Hex; timelock?: Hex | undefined },
) {
  const corrected = await Promise.all(
    stages.map(async (item) => {
      const data =
        item.stage === "deploy-factory-implementation"
          ? creationData.factory
          : item.stage === "deploy-testnet-timelock"
            ? creationData.timelock
            : undefined;
      if (!data)
        return { ...item, estimationSource: "local-fork-future-state" };
      const gas = await live.estimateGas({
        account: item.fundingAccount,
        data,
      });
      return {
        ...item,
        estimateGas: gas.toString(),
        estimationSource: "live-rpc-creation",
      };
    }),
  );
  const gasPrice = await live.getGasPrice();
  return {
    quotedAt: new Date().toISOString(),
    ...summarizeUpgradeFees(corrected, gasPrice),
    stages: corrected,
  };
}
