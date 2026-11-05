import {
  stockQuoteAssetRegistryAbi,
  stockQuoteDestinationRegistryAbi,
  stockQuoteOracleGuardAbi,
} from "@zkblast/abi";
import { getAddress, type Address, type Hex } from "viem";

import { X18, tokenRawToX18 } from "./amounts.js";
import { SdkError } from "./errors.js";

export type StockQuoteAvailability =
  | "discovered"
  | "verified"
  | "eligible"
  | "listed"
  | "suspended"
  | "disabled";

export type StockQuoteMarketState =
  | "active"
  | "after_hours"
  | "closed"
  | "halted"
  | "degraded"
  | "emergency";

export type StockQuoteOperation =
  | "create_launch"
  | "fund"
  | "buy"
  | "sell"
  | "graduate"
  | "exit";

export type StockQuoteContractAddresses = Readonly<{
  chainId: 4663;
  assetRegistry: Address;
  oracleGuard: Address;
  destinationRegistry?: Address;
}>;

export type StockQuoteGraduationMode = "damm" | "dlmm";

const graduationModeIds: Readonly<Record<StockQuoteGraduationMode, number>> = {
  damm: 0,
  dlmm: 1,
};

const operationIds: Readonly<Record<StockQuoteOperation, number>> = {
  create_launch: 0,
  fund: 1,
  buy: 2,
  sell: 3,
  graduate: 4,
  exit: 5,
};

export type StockQuoteAsset = Readonly<{
  chainId: 4663;
  issuerAssetId: Hex;
  contractAddress: Address;
  symbol: string;
  instrumentName: string;
  issuerName: string;
  tokenDecimals: number;
  currentMultiplierX18: bigint;
  availability: StockQuoteAvailability;
  marketState: StockQuoteMarketState;
  quoteTradingEnabled: boolean;
  graduationEnabled: boolean;
  priceFeedAddress?: Address;
  maxOracleAgeSeconds?: number;
}>;

export function normalizeStockQuoteAsset(input: StockQuoteAsset): StockQuoteAsset {
  if (
    input.chainId !== 4663 ||
    !/^0x[0-9a-fA-F]{64}$/u.test(input.issuerAssetId) ||
    !input.symbol.trim() ||
    !input.instrumentName.trim() ||
    !input.issuerName.trim() ||
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 36 ||
    input.currentMultiplierX18 <= 0n
  ) {
    throw new SdkError(
      "UNSUPPORTED_QUOTE_ASSET",
      "Stock quote metadata is incomplete or invalid",
    );
  }
  const contractAddress = getAddress(input.contractAddress);
  const priceFeedAddress = input.priceFeedAddress
    ? getAddress(input.priceFeedAddress)
    : undefined;
  if (
    (input.quoteTradingEnabled || input.graduationEnabled) &&
    (input.availability !== "listed" ||
      !priceFeedAddress ||
      !input.maxOracleAgeSeconds ||
      input.maxOracleAgeSeconds <= 0)
  ) {
    throw new SdkError(
      "UNSUPPORTED_QUOTE_ASSET",
      "Enabled stock quotes require a listed asset and oracle policy",
    );
  }
  return { ...input, contractAddress, ...(priceFeedAddress ? { priceFeedAddress } : {}) };
}

export function stockQuoteOperationAllowed(
  asset: StockQuoteAsset,
  operation: StockQuoteOperation,
  afterHoursBuyEnabled = false,
): boolean {
  if (asset.availability !== "listed") return false;
  if (operation === "graduate" && !asset.graduationEnabled) return false;
  if (
    ["create_launch", "fund", "buy"].includes(operation) &&
    !asset.quoteTradingEnabled
  ) {
    return false;
  }
  if (asset.marketState === "active") return true;
  if (asset.marketState === "after_hours") {
    return (
      operation === "sell" ||
      operation === "exit" ||
      (operation === "buy" && afterHoursBuyEnabled)
    );
  }
  if (["closed", "halted", "degraded"].includes(asset.marketState)) {
    return operation === "sell" || operation === "exit";
  }
  return operation === "exit";
}

export function stockQuoteUsdNotionalX18(input: Readonly<{
  rawAmount: bigint;
  tokenDecimals: number;
  priceX18: bigint;
  multiplierX18: bigint;
}>): bigint {
  if (input.rawAmount < 0n || input.priceX18 <= 0n || input.multiplierX18 <= 0n) {
    throw new SdkError("INVALID_AMOUNT", "Stock quote notional inputs are invalid");
  }
  const amountX18 =
    input.tokenDecimals <= 18
      ? tokenRawToX18(input.rawAmount, input.tokenDecimals)
      : input.rawAmount / 10n ** BigInt(input.tokenDecimals - 18);
  return (((amountX18 * input.priceX18) / X18) * input.multiplierX18) / X18;
}

/** Read-only calls used by clients to confirm onchain stock-quote authorization. */
export class StockQuoteClient {
  readonly addresses: StockQuoteContractAddresses;

  constructor(addresses: StockQuoteContractAddresses) {
    if (addresses.chainId !== 4663) {
      throw new SdkError(
        "INVALID_CHAIN",
        "Stock quote assets are not configured for the requested chain",
      );
    }
    this.addresses = {
      ...addresses,
      assetRegistry: getAddress(addresses.assetRegistry),
      oracleGuard: getAddress(addresses.oracleGuard),
      ...(addresses.destinationRegistry
        ? { destinationRegistry: getAddress(addresses.destinationRegistry) }
        : {}),
    };
  }

  destinationEnabled(asset: Address, mode: StockQuoteGraduationMode) {
    const destinationRegistry = this.addresses.destinationRegistry;
    if (!destinationRegistry) {
      throw new SdkError(
        "UNSUPPORTED_QUOTE_ASSET",
        "Stock quote destination registry is not configured",
      );
    }
    return {
      address: destinationRegistry,
      abi: stockQuoteDestinationRegistryAbi,
      functionName: "isEnabled",
      args: [getAddress(asset), graduationModeIds[mode]],
    } as const;
  }

  assetConfig(asset: Address) {
    return {
      address: this.addresses.assetRegistry,
      abi: stockQuoteAssetRegistryAbi,
      functionName: "quoteAssetConfig",
      args: [getAddress(asset)],
    } as const;
  }

  sessionPolicy(asset: Address) {
    return {
      address: this.addresses.oracleGuard,
      abi: stockQuoteOracleGuardAbi,
      functionName: "sessionPolicy",
      args: [getAddress(asset)],
    } as const;
  }

  validatedNotional(
    asset: Address,
    operation: StockQuoteOperation,
    rawAmount: bigint,
  ) {
    if (rawAmount < 0n) {
      throw new SdkError("INVALID_AMOUNT", "Raw stock quote amount cannot be negative");
    }
    return {
      address: this.addresses.oracleGuard,
      abi: stockQuoteOracleGuardAbi,
      functionName: "validatedUsdNotional",
      args: [getAddress(asset), operationIds[operation], rawAmount],
    } as const;
  }
}
