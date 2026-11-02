import {
  launchpadConfigManagerAbi,
  launchpadFactoryAbi,
  launchpadFeeCollectorAbi,
  launchpadFeeControllerAbi,
  launchpadTokenFactoryAbi,
} from "@zkblast/abi";
import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@zkblast/config";
import { getAddress, type Address, type Hex } from "viem";

import type { PreparedContractCall } from "./calls.js";
import { SdkError } from "./errors.js";

export type LaunchpadAddresses = Readonly<{
  abiVersion: 1;
  registry: Address;
  configManager: Address;
  factory: Address;
  lens: Address;
  feeController: Address;
  revenueSplitter: Address;
  feeCollector: Address;
  tokenFactory: Address;
}>;

export type LaunchpadTokenRequest = Readonly<{
  launchpadId: bigint;
  templateId: bigint;
  salt: Hex;
  name: string;
  symbol: string;
  metadataUri: string;
  creatorTokenRecipient: Address;
  referralRecipient: Address;
}>;

export type CreateLaunchpadRequest = Readonly<{
  owner: Address;
  treasury: Address;
  metadataHash: Hex;
  slugCommitment: Hex;
  configPresetId: bigint;
}>;

export type LaunchpadFeePolicyRequest = Readonly<{
  launchpadId: bigint;
  totalTradeFeeBps: number;
  protocolShareBps: number;
  operatorShareBps: number;
  creatorShareBps: number;
  referralShareBps: number;
  operatorRecipient: Address;
}>;

export function resolveLaunchpadAddresses(
  input: unknown,
  runtime: Readonly<{
    environment: DeploymentManifest["environment"];
    chainId: number;
  }>,
): LaunchpadAddresses {
  const deployment = parseDeploymentManifest(input, runtime).launchpad;
  if (
    !deployment?.feeController ||
    !deployment.revenueSplitter ||
    !deployment.feeCollector ||
    !deployment.tokenFactory
  ) {
    throw new SdkError(
      "LAUNCHPAD_NOT_DEPLOYED",
      `Launchpad is not fully deployed for ${runtime.environment} chain ${runtime.chainId}`,
    );
  }
  return {
    abiVersion: deployment.abiVersion,
    registry: getAddress(deployment.registry),
    configManager: getAddress(deployment.configManager),
    factory: getAddress(deployment.factory),
    lens: getAddress(deployment.lens),
    feeController: getAddress(deployment.feeController),
    revenueSplitter: getAddress(deployment.revenueSplitter),
    feeCollector: getAddress(deployment.feeCollector),
    tokenFactory: getAddress(deployment.tokenFactory),
  };
}

export function resolveLaunchpadAddressesFromApiConfig(input: unknown): LaunchpadAddresses {
  if (!input || typeof input!=="object") throw new SdkError("INVALID_API_CONFIG","API config is unavailable");
  const contracts=(input as { contracts?: unknown }).contracts;
  if (!Array.isArray(contracts)) throw new SdkError("LAUNCHPAD_NOT_DEPLOYED","API config has no launchpad contracts");
  const byName=new Map(contracts.filter((item): item is { name: string;address: string }=>Boolean(item)&&typeof item==="object"&&typeof (item as { name?: unknown }).name==="string"&&typeof (item as { address?: unknown }).address==="string").map((item)=>[item.name.toLowerCase(),item.address]));
  const address=(...names: string[])=>{ const value=names.map((name)=>byName.get(name.toLowerCase())).find(Boolean);if (!value) throw new SdkError("LAUNCHPAD_NOT_DEPLOYED",`Missing ${names[0]} in API config`);return getAddress(value); };
  return { abiVersion:1,registry:address("LaunchpadRegistry"),configManager:address("LaunchpadConfigManager"),factory:address("LaunchpadFactory"),lens:address("LaunchpadLens"),feeController:address("LaunchpadFeeController"),revenueSplitter:address("LaunchpadRevenueSplitter"),feeCollector:address("LaunchpadFeeCollector"),tokenFactory:address("LaunchpadTokenFactory") };
}

export class LaunchpadClient {
  readonly addresses: LaunchpadAddresses;

  constructor(addresses: LaunchpadAddresses) {
    this.addresses = addresses;
  }

  graduationCapability(destination: 1 | 2) {
    return {
      address: this.addresses.configManager,
      abi: launchpadConfigManagerAbi,
      functionName: "destinationSupported",
      args: [destination],
    } as const;
  }

  createLaunchpad(input: CreateLaunchpadRequest): PreparedContractCall {
    if (input.configPresetId <= 0n)
      throw new SdkError(
        "LAUNCHPAD_PRESET_INVALID",
        "Config preset ID must be positive",
      );
    return {
      address: this.addresses.factory,
      abi: launchpadFactoryAbi,
      functionName: "createLaunchpad",
      args: [
        getAddress(input.owner),
        getAddress(input.treasury),
        input.metadataHash,
        input.slugCommitment,
        input.configPresetId,
      ],
    };
  }

  createToken(input: LaunchpadTokenRequest): PreparedContractCall {
    return {
      address: this.addresses.tokenFactory,
      abi: launchpadTokenFactoryAbi,
      functionName: "createLaunch",
      args: [
        {
          launchpadId: input.launchpadId,
          dbc: {
            templateId: input.templateId,
            salt: input.salt,
            name: input.name,
            symbol: input.symbol,
            metadataURI: input.metadataUri,
            creatorTokenRecipient: getAddress(input.creatorTokenRecipient),
          },
          referralRecipient: getAddress(input.referralRecipient),
        },
      ],
    };
  }

  setFeePolicy(input: LaunchpadFeePolicyRequest): PreparedContractCall {
    const shares = [
      input.protocolShareBps,
      input.operatorShareBps,
      input.creatorShareBps,
      input.referralShareBps,
    ];
    if (
      input.launchpadId <= 0n ||
      !Number.isInteger(input.totalTradeFeeBps) ||
      input.totalTradeFeeBps < 0 ||
      input.totalTradeFeeBps > 300 ||
      shares.some(
        (share) => !Number.isInteger(share) || share < 0 || share > 10_000,
      ) ||
      shares.reduce((sum, share) => sum + share, 0) !== 10_000
    ) {
      throw new SdkError(
        "LAUNCHPAD_FEE_POLICY_INVALID",
        "Fee policy must use valid basis points and shares must total 10,000",
      );
    }
    return {
      address: this.addresses.feeController,
      abi: launchpadFeeControllerAbi,
      functionName: "setLaunchpadFeePolicy",
      args: [
        input.launchpadId,
        input.totalTradeFeeBps,
        {
          protocolShareBps: input.protocolShareBps,
          operatorShareBps: input.operatorShareBps,
          creatorShareBps: input.creatorShareBps,
          referralShareBps: input.referralShareBps,
        },
        getAddress(input.operatorRecipient),
      ],
    };
  }

  binding(launchId: Hex) {
    return {
      address: this.addresses.tokenFactory,
      abi: launchpadTokenFactoryAbi,
      functionName: "binding",
      args: [launchId],
    } as const;
  }

  collectTradeFees(pool: Address): PreparedContractCall {
    return {
      address: this.addresses.feeCollector,
      abi: launchpadFeeCollectorAbi,
      functionName: "collectTradeFees",
      args: [getAddress(pool)],
    };
  }
}
