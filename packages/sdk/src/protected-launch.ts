import {
  launchProtectionPolicyRegistryAbi,
  protectedGraduationManagerAbi,
  protectedLaunchIdentityRegistryAbi,
  protectedLaunchRouterAbi,
  protectedLpAllocationEscrowAbi,
  protectedLaunchFactoryAbi,
  protectedLaunchTokenAbi,
  protectedVirtualPoolAbi,
} from "@zkblast/abi";
import { getAddress, type Address, type Hex } from "viem";

import type { PreparedContractCall } from "./calls.js";
import { SdkError } from "./errors.js";

export type ProtectedLaunchAddresses = Readonly<{
  chainId: number;
  policyRegistry: Address;
  launchFactory: Address;
  launchRouter: Address;
  lpEscrow: Address;
  graduationManager: Address;
  identityRegistry: Address;
}>;

export type ProtectionPolicy = Readonly<{
  familyId: Hex;
  policyHash: Hex;
  protectionBlocks: number;
  maxBuyBpsPerTransaction: number;
  maxBuyBpsPerAddress: number;
  initialFeeBps: number;
  baseFeeBps: number;
  lpLockSeconds: bigint;
  version: number;
  batchMode: boolean;
  enabled: boolean;
  used: boolean;
}>;

export type ProtectedLaunchRequest = Readonly<{
  templateId: bigint;
  policyId: bigint;
  salt: Hex;
  deadline: bigint;
  name: string;
  symbol: string;
  metadataUri: string;
  creatorTokenRecipient: Address;
}>;

export type ProtectedBuySimulation = Readonly<{
  quotedBaseOutRaw: bigint;
  purchasedDuringProtectionRaw: bigint;
  maximumPerTransactionRaw: bigint;
  maximumPerAddressRaw: bigint;
}>;

export function protectionBlocksForDuration(input: Readonly<{
  durationSeconds: number;
  measuredBlockMilliseconds: number;
  maximumBlocks?: number;
}>): number {
  if (
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds <= 0 ||
    !Number.isFinite(input.measuredBlockMilliseconds) ||
    input.measuredBlockMilliseconds < 50 ||
    input.measuredBlockMilliseconds > 60_000
  ) {
    throw new SdkError(
      "INVALID_CURVE_CONFIG",
      "Protection duration requires a measured positive block cadence",
    );
  }
  const blocks = Math.ceil(
    (input.durationSeconds * 1_000) / input.measuredBlockMilliseconds,
  );
  const maximumBlocks = input.maximumBlocks ?? 1_000_000;
  if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > maximumBlocks) {
    throw new SdkError(
      "INVALID_CURVE_CONFIG",
      "Protection block window exceeds the configured bound",
    );
  }
  return blocks;
}

export function assertProtectedLaunchCapability(
  addresses: ProtectedLaunchAddresses,
  actualChainId: number,
): void {
  if (actualChainId !== addresses.chainId) {
    throw new SdkError(
      "INVALID_CHAIN",
      "Protected Launch is not configured for the connected chain",
    );
  }
  for (const address of Object.values(addresses).slice(1)) {
    getAddress(address as Address);
  }
}

export function simulateProtectedBuy(input: ProtectedBuySimulation): Readonly<{
  allowed: boolean;
  remainingAddressAllocationRaw: bigint;
  reason?: "TRANSACTION_CAP" | "ADDRESS_CAP";
}> {
  const remaining =
    input.purchasedDuringProtectionRaw >= input.maximumPerAddressRaw
      ? 0n
      : input.maximumPerAddressRaw - input.purchasedDuringProtectionRaw;
  if (input.quotedBaseOutRaw > input.maximumPerTransactionRaw) {
    return {
      allowed: false,
      remainingAddressAllocationRaw: remaining,
      reason: "TRANSACTION_CAP",
    };
  }
  if (input.quotedBaseOutRaw > remaining) {
    return {
      allowed: false,
      remainingAddressAllocationRaw: remaining,
      reason: "ADDRESS_CAP",
    };
  }
  return {
    allowed: true,
    remainingAddressAllocationRaw: remaining - input.quotedBaseOutRaw,
  };
}

export class ProtectedLaunchClient {
  readonly addresses: ProtectedLaunchAddresses;

  constructor(addresses: ProtectedLaunchAddresses) {
    this.addresses = addresses;
  }

  getProtectionPolicy(policyId: bigint) {
    return {
      address: this.addresses.policyRegistry,
      abi: launchProtectionPolicyRegistryAbi,
      functionName: "policy",
      args: [policyId],
    } as const;
  }

  launch(launchId: Hex) {
    return {
      address: this.addresses.launchFactory,
      abi: protectedLaunchFactoryAbi,
      functionName: "launches",
      args: [launchId],
    } as const;
  }

  tokenProtection(token: Address, buyer: Address) {
    return {
      limits: {
        address: token,
        abi: protectedLaunchTokenAbi,
        functionName: "remainingProtectedAllocation",
        args: [buyer],
      },
      active: {
        address: token,
        abi: protectedLaunchTokenAbi,
        functionName: "protectionActive",
        args: [],
      },
    } as const;
  }

  liquidityLock(migrationId: Hex) {
    return {
      address: this.addresses.lpEscrow,
      abi: protectedLpAllocationEscrowAbi,
      functionName: "getAllocation",
      args: [migrationId],
    } as const;
  }

  identityRisk(launchId: Hex) {
    return {
      address: this.addresses.identityRegistry,
      abi: protectedLaunchIdentityRegistryAbi,
      functionName: "identity",
      args: [launchId],
    } as const;
  }

  graduationState(pool: Address, migrationId: Hex) {
    return {
      pool: {
        address: pool,
        abi: protectedVirtualPoolAbi,
        functionName: "graduationState",
        args: [],
      },
      attempt: {
        address: this.addresses.graduationManager,
        abi: protectedGraduationManagerAbi,
        functionName: "migrationAttemptState",
        args: [migrationId],
      },
      context: {
        address: this.addresses.graduationManager,
        abi: protectedGraduationManagerAbi,
        functionName: "migrationContext",
        args: [migrationId],
      },
      accountingReconciles: {
        address: this.addresses.graduationManager,
        abi: protectedGraduationManagerAbi,
        functionName: "accountingReconciles",
        args: [migrationId],
      },
    } as const;
  }

  quoteBuy(pool: Address, grossQuoteInRaw: bigint) {
    return {
      address: pool,
      abi: protectedVirtualPoolAbi,
      functionName: "quoteBuyExactInput",
      args: [grossQuoteInRaw],
    } as const;
  }

  buyExactInput(input: Readonly<{
    pool: Address;
    grossQuoteInRaw: bigint;
    minimumBaseOutRaw: bigint;
    maximumPriceX18: bigint;
    recipient: Address;
    deadline: bigint;
  }>): PreparedContractCall {
    return {
      address: this.addresses.launchRouter,
      abi: protectedLaunchRouterAbi,
      functionName: "buyExactInput",
      args: [input.pool,input.grossQuoteInRaw,input.minimumBaseOutRaw,input.maximumPriceX18,input.recipient,input.deadline],
    };
  }

  sellExactInput(input: Readonly<{
    pool: Address;
    baseInRaw: bigint;
    minimumQuoteOutRaw: bigint;
    minimumPriceX18: bigint;
    recipient: Address;
    deadline: bigint;
  }>): PreparedContractCall {
    return {
      address: this.addresses.launchRouter,
      abi: protectedLaunchRouterAbi,
      functionName: "sellExactInput",
      args: [input.pool,input.baseInRaw,input.minimumQuoteOutRaw,input.minimumPriceX18,input.recipient,input.deadline],
    };
  }

  createProtectedLaunch(input: ProtectedLaunchRequest): PreparedContractCall {
    return {
      address: this.addresses.launchFactory,
      abi: protectedLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          templateId: input.templateId,
          policyId: input.policyId,
          salt: input.salt,
          deadline: input.deadline,
          name: input.name,
          symbol: input.symbol,
          metadataURI: input.metadataUri,
          creatorTokenRecipient: input.creatorTokenRecipient,
        },
      ],
    };
  }
}
