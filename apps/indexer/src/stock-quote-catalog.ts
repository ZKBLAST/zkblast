import {
  stockQuoteCatalogRecordSchema,
  type StockQuoteCatalogRecord,
} from "@zkblast/database";
import { keccak256, stringToHex, type Address, type Hex } from "viem";

export type IssuerStockAsset = Readonly<{
  id: Hex;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  currentMultiplier: string;
  pendingMultiplier: string;
  status:
    | "ASSET_STATUS_ACTIVE"
    | "ASSET_STATUS_INACTIVE"
    | "ASSET_STATUS_UNSPECIFIED";
  deployment: Readonly<{ chainId: 4663; contractAddress: Address }>;
}>;

export type StockQuoteChainReader = Readonly<{
  chainId(): Promise<number>;
  bytecode(address: Address): Promise<Hex | undefined>;
  decimals(address: Address): Promise<number>;
}>;

export type IssuerStockQuote = Readonly<{
  isTradingHalt: boolean;
  generatedAt: string;
}>;

export function assertStockQuoteSnapshotFresh(
  observedAt: string,
  nowMs: number,
  maximumAgeSeconds: number,
): void {
  const observedMs = Date.parse(observedAt);
  if (
    !Number.isFinite(observedMs) ||
    maximumAgeSeconds <= 0 ||
    observedMs > nowMs ||
    nowMs - observedMs > maximumAgeSeconds * 1_000
  ) {
    throw new Error("STOCK_QUOTE_CATALOG_SNAPSHOT_STALE");
  }
}

/// Builds a fail-closed discovery record. Onchain listing and oracle policy are separate steps.
export function stockQuoteDiscoveryRecord(
  asset: IssuerStockAsset,
  quote: IssuerStockQuote,
  issuerName: string,
): StockQuoteCatalogRecord {
  const availability = asset.status === "ASSET_STATUS_ACTIVE" ? "verified" : "suspended";
  const marketState = quote.isTradingHalt
    ? "halted"
    : asset.status === "ASSET_STATUS_ACTIVE"
      ? "active"
      : "degraded";
  const sourceHash = keccak256(
    stringToHex(
      JSON.stringify({
        id: asset.id.toLowerCase(),
        address: asset.deployment.contractAddress.toLowerCase(),
        multiplier: asset.currentMultiplier,
        pendingMultiplier: asset.pendingMultiplier,
        status: asset.status,
        marketState,
        generatedAt: quote.generatedAt,
      }),
    ),
  );
  return stockQuoteCatalogRecordSchema.parse({
    chainId: asset.deployment.chainId,
    issuerAssetId: asset.id,
    contractAddress: asset.deployment.contractAddress,
    symbol: asset.tokenSymbol,
    instrumentName: asset.tokenName,
    issuerName,
    tokenDecimals: asset.tokenDecimals,
    currentMultiplier: asset.currentMultiplier,
    pendingMultiplier: asset.pendingMultiplier,
    availability,
    marketState,
    quoteTradingEnabled: false,
    graduationEnabled: false,
    priceFeedAddress: null,
    maxOracleAgeSeconds: null,
    observedAt: quote.generatedAt,
    sourceHash,
  });
}

/** Promotes only address-bound records whose deployed code and decimals match the issuer catalog. */
export async function verifyStockQuoteAssetOnchain(
  reader: StockQuoteChainReader,
  record: StockQuoteCatalogRecord,
): Promise<StockQuoteCatalogRecord> {
  const chainId = await reader.chainId();
  if (chainId !== record.chainId) throw new Error("STOCK_QUOTE_CHAIN_MISMATCH");
  const [bytecode, decimals] = await Promise.all([
    reader.bytecode(record.contractAddress as Address),
    reader.decimals(record.contractAddress as Address),
  ]);
  if (!bytecode || bytecode === "0x") throw new Error("STOCK_QUOTE_CODE_MISSING");
  if (decimals !== record.tokenDecimals) throw new Error("STOCK_QUOTE_DECIMALS_MISMATCH");
  return stockQuoteCatalogRecordSchema.parse({ ...record, availability: "eligible" });
}
