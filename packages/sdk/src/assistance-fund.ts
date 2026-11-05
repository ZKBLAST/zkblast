import {
  assistanceFeeCollectorAbi,
  assistanceFundExecutorAbi,
  buybackRouteRegistryAbi,
} from "@zkblast/abi";
import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@zkblast/config";
import { getAddress, type Address, type Hex } from "viem";
import type { PreparedContractCall } from "./calls.js";
import { SdkError } from "./errors.js";

export type AssistanceFundAddresses = Readonly<{
  registry: Address;
  collector: Address;
  treasuryController: Address;
  routeRegistry: Address;
  executor: Address;
  burnModule: Address;
  protocolToken: Address;
}>;

export type AssistanceAssetLedger = Readonly<{
  collected: bigint;
  allocatedBuyback: bigint;
  allocatedTreasury: bigint;
  spentBuyback: bigint;
  claimedTreasury: bigint;
  burnedProtocolToken: bigint;
}>;

export type AssistanceReconciliation = Readonly<{
  balance: bigint;
  pendingBuyback: bigint;
  treasuryClaimable: bigint;
  liability: bigint;
  surplus: bigint;
  solvent: boolean;
}>;

export type AssistanceExecutionPreview = Readonly<{
  executable: boolean;
  amountIn: bigint;
  minimumAmountOut: bigint;
  reason: "ready" | "disabled" | "below-minimum" | "above-maximum" | "slippage";
}>;

type ReadClient = Readonly<{
  readContract(request: Readonly<Record<string, unknown>>): Promise<unknown>;
}>;

export function resolveAssistanceFundAddresses(
  input: unknown,
  runtime: Readonly<{
    environment: DeploymentManifest["environment"];
    chainId: number;
  }>,
): AssistanceFundAddresses {
  const manifest = parseDeploymentManifest(input, runtime);
  const deployment = manifest.assistanceFund;
  if (!deployment) {
    throw new SdkError(
      "ASSISTANCE_FUND_NOT_DEPLOYED",
      `Assistance Fund is not deployed on chain ${manifest.chainId}`,
    );
  }
  return {
    registry: getAddress(deployment.registry),
    collector: getAddress(deployment.collector),
    treasuryController: getAddress(deployment.treasuryController),
    routeRegistry: getAddress(deployment.routeRegistry),
    executor: getAddress(deployment.executor),
    burnModule: getAddress(deployment.burnModule),
    protocolToken: getAddress(deployment.protocolToken),
  };
}

export async function readAssistanceReconciliation(
  client: ReadClient,
  collector: Address,
  asset: Address,
): Promise<AssistanceReconciliation> {
  const result = (await client.readContract({
    address: collector,
    abi: assistanceFeeCollectorAbi,
    functionName: "reconciliation",
    args: [asset],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, boolean];
  return {
    balance: result[0],
    pendingBuyback: result[1],
    treasuryClaimable: result[2],
    liability: result[3],
    surplus: result[4],
    solvent: result[5],
  };
}

export async function readAssistanceAssetLedger(
  client: ReadClient,
  collector: Address,
  asset: Address,
): Promise<AssistanceAssetLedger> {
  const result = (await client.readContract({
    address: collector,
    abi: assistanceFeeCollectorAbi,
    functionName: "assetLedger",
    args: [asset],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  return {
    collected: result[0],
    allocatedBuyback: result[1],
    allocatedTreasury: result[2],
    spentBuyback: result[3],
    claimedTreasury: result[4],
    burnedProtocolToken: result[5],
  };
}

export async function readAssistanceRoute(
  client: ReadClient,
  routeRegistry: Address,
  routeId: Hex,
): Promise<unknown> {
  return client.readContract({
    address: routeRegistry,
    abi: buybackRouteRegistryAbi,
    functionName: "getRoute",
    args: [routeId],
  });
}

export function previewAssistanceExecution(
  input: Readonly<{
    amountIn: bigint;
    quotedAmountOut: bigint;
    minimumAmount: bigint;
    maximumAmount: bigint;
    maximumSlippageBps: number;
    enabled: boolean;
  }>,
): AssistanceExecutionPreview {
  if (!input.enabled)
    return {
      executable: false,
      amountIn: input.amountIn,
      minimumAmountOut: 0n,
      reason: "disabled",
    };
  if (input.amountIn < input.minimumAmount)
    return {
      executable: false,
      amountIn: input.amountIn,
      minimumAmountOut: 0n,
      reason: "below-minimum",
    };
  if (input.amountIn > input.maximumAmount)
    return {
      executable: false,
      amountIn: input.amountIn,
      minimumAmountOut: 0n,
      reason: "above-maximum",
    };
  if (input.maximumSlippageBps <= 0 || input.maximumSlippageBps >= 10_000)
    return {
      executable: false,
      amountIn: input.amountIn,
      minimumAmountOut: 0n,
      reason: "slippage",
    };
  return {
    executable: true,
    amountIn: input.amountIn,
    minimumAmountOut:
      (input.quotedAmountOut * BigInt(10_000 - input.maximumSlippageBps)) /
      10_000n,
    reason: "ready",
  };
}

export function buildAssistanceBuyback(
  input: Readonly<{
    executor: Address;
    routeId: Hex;
    amountIn: bigint;
    minimumAmountOut: bigint;
    deadline: bigint;
  }>,
): PreparedContractCall {
  if (input.amountIn <= 0n || input.minimumAmountOut <= 0n) {
    throw new SdkError("INVALID_AMOUNT", "Buyback amounts must be positive");
  }
  return {
    address: input.executor,
    abi: assistanceFundExecutorAbi,
    functionName: "executeBuyback",
    args: [
      input.routeId,
      input.amountIn,
      input.minimumAmountOut,
      input.deadline,
    ],
  };
}
