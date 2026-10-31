import {
  graduationManagerAbi,
  launchConfigRegistryAbi,
  launchFactoryAbi,
  lpAllocationEscrowAbi,
  virtualPoolAbi,
} from "@zkblast/abi";
import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@zkblast/config";
import { getAddress, type Address, type Hex } from "viem";

import type { PreparedContractCall } from "./calls.js";
import { SdkError } from "./errors.js";

export type DbcAddresses = Readonly<{
  abiVersion: 1;
  configRegistry: Address;
  launchTokenDeployer?: Address;
  virtualPoolDeployer?: Address;
  launchFactory: Address;
  curveQuoter: Address;
  launchpadRouter: Address;
  graduationManager: Address;
  dammGraduationAdapter: Address;
  lpAllocationEscrow: Address;
}>;

export type DbcLaunchRequest = Readonly<{
  templateId: bigint;
  salt: Hex;
  name: string;
  symbol: string;
  metadataUri: string;
  creatorTokenRecipient: Address;
}>;

export type DbcPreflight = Readonly<{
  expectedChainId: number;
  actualChainId: number;
  nowSeconds: number;
  deadline: bigint;
  lifecycle?: number;
  allowedLifecycles?: readonly number[];
  requiredBalance?: bigint;
  balance?: bigint;
  requiredAllowance?: bigint;
  allowance?: bigint;
  quoteObservedAtSeconds?: number;
  maximumQuoteAgeSeconds?: number;
  quotedAmountOut?: bigint;
  minimumAmountOut?: bigint;
  maximumSlippageBps?: number;
}>;

export type DbcTransactionState =
  | Readonly<{ status: "prepared"; call: PreparedContractCall }>
  | Readonly<{ status: "signing"; call: PreparedContractCall }>
  | Readonly<{ status: "submitted"; hash: Hex }>
  | Readonly<{ status: "confirmed"; hash: Hex; blockNumber: bigint }>
  | Readonly<{ status: "failed"; code: string; message: string }>;

export function resolveDbcAddresses(
  input: unknown,
  runtime: Readonly<{
    environment: DeploymentManifest["environment"];
    chainId: number;
  }>,
): DbcAddresses {
  const manifest = parseDeploymentManifest(input, runtime);
  if (!manifest.dbc) {
    throw new SdkError(
      "DBC_NOT_DEPLOYED",
      `DBC is not deployed for ${runtime.environment} chain ${runtime.chainId}`,
    );
  }
  return {
    abiVersion: manifest.dbc.abiVersion,
    configRegistry: getAddress(manifest.dbc.configRegistry),
    launchFactory: getAddress(manifest.dbc.launchFactory),
    curveQuoter: getAddress(manifest.dbc.curveQuoter),
    launchpadRouter: getAddress(manifest.dbc.launchpadRouter),
    graduationManager: getAddress(manifest.dbc.graduationManager),
    dammGraduationAdapter: getAddress(manifest.dbc.dammGraduationAdapter),
    lpAllocationEscrow: getAddress(manifest.dbc.lpAllocationEscrow),
  };
}

export function assertDbcPreflight(input: DbcPreflight): void {
  if (input.actualChainId !== input.expectedChainId) {
    throw new SdkError(
      "INVALID_CHAIN",
      "Wallet network does not match the selected deployment",
    );
  }
  if (input.deadline <= BigInt(input.nowSeconds)) {
    throw new SdkError("INVALID_DEADLINE", "Transaction deadline has expired");
  }
  if (
    input.allowedLifecycles &&
    (input.lifecycle === undefined ||
      !input.allowedLifecycles.includes(input.lifecycle))
  ) {
    throw new SdkError(
      "INVALID_LIFECYCLE",
      "Launch lifecycle does not allow this action",
    );
  }
  if (
    input.requiredBalance !== undefined &&
    (input.balance === undefined || input.balance < input.requiredBalance)
  ) {
    throw new SdkError("INSUFFICIENT_BALANCE", "Token balance is insufficient");
  }
  if (
    input.requiredAllowance !== undefined &&
    (input.allowance === undefined || input.allowance < input.requiredAllowance)
  ) {
    throw new SdkError(
      "INSUFFICIENT_ALLOWANCE",
      "Token allowance is insufficient",
    );
  }
  if (
    input.quoteObservedAtSeconds !== undefined &&
    input.maximumQuoteAgeSeconds !== undefined &&
    input.nowSeconds - input.quoteObservedAtSeconds >
      input.maximumQuoteAgeSeconds
  ) {
    throw new SdkError("STALE_QUOTE", "Quote is stale and must be refreshed");
  }
  if (
    input.quotedAmountOut !== undefined &&
    input.minimumAmountOut !== undefined &&
    input.maximumSlippageBps !== undefined
  ) {
    if (
      !Number.isInteger(input.maximumSlippageBps) ||
      input.maximumSlippageBps < 0 ||
      input.maximumSlippageBps > 10_000
    ) {
      throw new SdkError("INVALID_SLIPPAGE", "Slippage limit is invalid");
    }
    const floor =
      (input.quotedAmountOut * BigInt(10_000 - input.maximumSlippageBps)) /
      10_000n;
    if (input.minimumAmountOut < floor) {
      throw new SdkError(
        "INVALID_SLIPPAGE",
        "Minimum output exceeds the allowed slippage",
      );
    }
  }
}

export class DbcClient {
  readonly addresses: DbcAddresses;

  constructor(addresses: DbcAddresses) {
    this.addresses = addresses;
  }

  template(templateId: bigint) {
    return {
      address: this.addresses.configRegistry,
      abi: launchConfigRegistryAbi,
      functionName: "templateSummary",
      args: [templateId],
    } as const;
  }

  launch(launchId: Hex) {
    return {
      address: this.addresses.launchFactory,
      abi: launchFactoryAbi,
      functionName: "launches",
      args: [launchId],
    } as const;
  }

  launchState(pool: Address) {
    return {
      lifecycle: {
        address: pool,
        abi: virtualPoolAbi,
        functionName: "lifecycle",
        args: [],
      },
      progress: {
        address: pool,
        abi: virtualPoolAbi,
        functionName: "graduationProgressBps",
        args: [],
      },
    } as const;
  }

  quoteBuy(pool: Address, grossQuoteInRaw: bigint) {
    return {
      address: pool,
      abi: virtualPoolAbi,
      functionName: "quoteBuyExactInput",
      args: [grossQuoteInRaw],
    } as const;
  }

  quoteSell(pool: Address, baseInRaw: bigint) {
    return {
      address: pool,
      abi: virtualPoolAbi,
      functionName: "quoteSellExactInput",
      args: [baseInRaw],
    } as const;
  }

  createLaunch(input: DbcLaunchRequest): PreparedContractCall {
    return {
      address: this.addresses.launchFactory,
      abi: launchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          templateId: input.templateId,
          salt: input.salt,
          name: input.name,
          symbol: input.symbol,
          metadataURI: input.metadataUri,
          creatorTokenRecipient: input.creatorTokenRecipient,
        },
      ],
    };
  }

  buyExactInput(
    input: Readonly<{
      pool: Address;
      grossQuoteInRaw: bigint;
      minimumBaseOutRaw: bigint;
      maximumPriceX18: bigint;
      recipient: Address;
      deadline: bigint;
    }>,
  ): PreparedContractCall {
    return {
      address: input.pool,
      abi: virtualPoolAbi,
      functionName: "buyExactInput",
      args: [
        input.grossQuoteInRaw,
        input.minimumBaseOutRaw,
        input.maximumPriceX18,
        input.recipient,
        input.deadline,
      ],
    };
  }

  sellExactInput(
    input: Readonly<{
      pool: Address;
      baseInRaw: bigint;
      minimumQuoteOutRaw: bigint;
      minimumPriceX18: bigint;
      recipient: Address;
      deadline: bigint;
    }>,
  ): PreparedContractCall {
    return {
      address: input.pool,
      abi: virtualPoolAbi,
      functionName: "sellExactInput",
      args: [
        input.baseInRaw,
        input.minimumQuoteOutRaw,
        input.minimumPriceX18,
        input.recipient,
        input.deadline,
      ],
    };
  }

  graduate(pool: Address, deadline: bigint): PreparedContractCall {
    return {
      address: this.addresses.graduationManager,
      abi: graduationManagerAbi,
      functionName: "graduate",
      args: [pool, this.addresses.dammGraduationAdapter, deadline],
    };
  }

  claimFees(pool: Address, allocation: 0 | 1 | 2): PreparedContractCall {
    return {
      address: pool,
      abi: virtualPoolAbi,
      functionName: "claimFees",
      args: [allocation],
    };
  }

  claimLp(
    migrationId: Hex,
    creatorAllocation: boolean,
    deadline: bigint,
  ): PreparedContractCall {
    return {
      address: this.addresses.lpAllocationEscrow,
      abi: lpAllocationEscrowAbi,
      functionName: "claim",
      args: [migrationId, creatorAllocation, deadline],
    };
  }
}
