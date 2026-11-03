import type { Address } from "viem";
import type { DbcAddresses } from "@zkblast/sdk";
import { z } from "zod";

const templateEconomicsSchema = z.tuple([
  z.string(),
  z.bigint(),
  z.bigint(),
  z.bigint(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export type DbcPage = Readonly<{ limit: number; cursor?: string | undefined }>;
export type DbcCandleQuery = Readonly<{
  interval: "1m" | "5m" | "15m" | "1h" | "1d";
  from: Date;
  to: Date;
  limit: number;
}>;
export type DbcLaunchMetadata = Readonly<{
  metadataId: string;
  metadataUri: string;
  websiteUrl: string | null;
  xUrl: string | null;
  logoMime: "image/png" | "image/jpeg" | "image/webp" | null;
  logoBytes: Buffer | null;
}>;
export interface DbcReadStore {
  templates(page: DbcPage): Promise<readonly unknown[]>;
  launches(
    page: DbcPage &
      Readonly<{
        search?: string | undefined;
        lifecycle?: number | undefined;
        launchpadId?: string | undefined;
      }>,
  ): Promise<readonly unknown[]>;
  launch(launchId: string): Promise<unknown>;
  launchByPool(pool: Address): Promise<Readonly<{ lifecycle: number }> | null>;
  trades(launchId: string, page: DbcPage): Promise<readonly unknown[]>;
  candles(launchId: string, query: DbcCandleQuery): Promise<readonly unknown[]>;
  graduation(launchId: string): Promise<unknown>;
  saveMetadata(input: DbcLaunchMetadata): Promise<void>;
  metadata(metadataId: string): Promise<DbcLaunchMetadata | null>;
  protectionPolicies(page: DbcPage): Promise<readonly unknown[]>;
  protectionPolicy(policyId: bigint): Promise<Record<string, unknown> | null>;
  protectedLaunchSecurity(launchId: string): Promise<unknown>;
  protectedLaunchIdentity(launchId: string): Promise<unknown>;
}
export interface DbcQuoteReader {
  quote(
    input: Readonly<{ pool: Address; side: "buy" | "sell"; amountRaw: bigint }>,
  ): Promise<unknown>;
  templateEconomics(templateId: bigint): Promise<unknown>;
  templateConfig(templateId: bigint): Promise<unknown>;
  tokenMetadata(token: Address): Promise<
    Readonly<{ symbol: string; decimals: number }>
  >;
}

export class DbcService {
  constructor(
    private readonly store: DbcReadStore,
    private readonly quoteReader: DbcQuoteReader,
    private readonly deployment: DbcAddresses,
  ) {}
  templates(page: DbcPage) {
    return this.store.templates(page);
  }
  launches(
    query: DbcPage &
      Readonly<{
        search?: string | undefined;
        lifecycle?: number | undefined;
        launchpadId?: string | undefined;
      }>,
  ) {
    return this.store.launches(query);
  }
  launch(launchId: string) {
    return this.store.launch(launchId);
  }
  trades(launchId: string, page: DbcPage) {
    return this.store.trades(launchId, page);
  }
  candles(launchId: string, query: DbcCandleQuery) {
    return this.store.candles(launchId, query);
  }
  graduation(launchId: string) {
    return this.store.graduation(launchId);
  }
  saveMetadata(input: DbcLaunchMetadata) {
    return this.store.saveMetadata(input);
  }
  metadata(metadataId: string) {
    return this.store.metadata(metadataId);
  }
  protectionPolicies(page: DbcPage) {
    return this.store.protectionPolicies(page);
  }
  protectedLaunchSecurity(launchId: string) {
    return this.store.protectedLaunchSecurity(launchId);
  }
  protectedLaunchIdentity(launchId: string) {
    return this.store.protectedLaunchIdentity(launchId);
  }
  async protectedLaunchPreview(input: Readonly<{
    policyId: bigint;
    baseInventoryRaw: bigint;
    currentBlock: bigint;
  }>) {
    const policy = await this.store.protectionPolicy(input.policyId);
    if (!policy) throw new Error("PROTECTION_POLICY_NOT_FOUND");
    if (policy.enabled !== true || policy.used === true)
      throw new Error("PROTECTION_POLICY_UNAVAILABLE");
    const protectionBlocks = BigInt(String(policy.protection_blocks));
    const transactionBps = BigInt(String(policy.max_buy_bps_per_transaction));
    const addressBps = BigInt(String(policy.max_buy_bps_per_address));
    return {
      chainId: Number(policy.chain_id),
      policyId: String(policy.policy_id),
      policyHash: String(policy.policy_hash),
      policyVersion: Number(policy.version),
      protectionStartBlock: input.currentBlock,
      protectionEndBlock: input.currentBlock + protectionBlocks,
      maximumPerTransactionRaw:
        (input.baseInventoryRaw * transactionBps) / 10_000n,
      maximumPerAddressRaw: (input.baseInventoryRaw * addressBps) / 10_000n,
      initialFeeBps: Number(policy.initial_fee_bps),
      baseFeeBps: Number(policy.base_fee_bps),
      lpLockSeconds: String(policy.lp_lock_seconds),
      enforcement: "onchain",
    };
  }
  async quote(pool: Address, side: "buy" | "sell", amountRaw: bigint) {
    const launch = await this.store.launchByPool(pool);
    if (!launch) throw new Error("DBC_POOL_NOT_FOUND");
    if (launch.lifecycle !== 1) throw new Error("DBC_CURVE_TRADING_CLOSED");
    return this.quoteReader.quote({ pool, side, amountRaw });
  }
  async templateEconomics(templateId: bigint) {
    const parsed = templateEconomicsSchema.safeParse(
      await this.quoteReader.templateEconomics(templateId),
    );
    if (!parsed.success) throw new Error("DBC_TEMPLATE_ECONOMICS_INVALID");
    const [
      quoteToken,
      totalSupplyRaw,
      baseInventoryRaw,
      graduationThresholdRaw,
      destinationFeePips,
      terminalPriceToleranceBps,
      tradeFeeBps,
      creatorFeeShareBps,
      partnerFeeShareBps,
      protocolFeeShareBps,
      creatorLpShareBps,
      creatorLockSeconds,
    ] = parsed.data;
    const config = (await this.quoteReader.templateConfig(templateId)) as {
      curve?: {
        segmentCount?: number;
        segments?: readonly Readonly<{
          initialPriceX18?: bigint;
          slopeX18?: bigint;
          saleCapacityX18?: bigint;
        }>[];
      };
    };
    const segmentCount = config.curve?.segmentCount ?? 0;
    const curveSegments = (config.curve?.segments ?? [])
      .slice(0, segmentCount)
      .map((segment) => ({
        initialPriceX18: BigInt(segment.initialPriceX18 ?? 0n).toString(),
        slopeX18: BigInt(segment.slopeX18 ?? 0n).toString(),
        saleCapacityX18: BigInt(segment.saleCapacityX18 ?? 0n).toString(),
      }));
    if (curveSegments.length !== segmentCount || segmentCount < 1)
      throw new Error("DBC_TEMPLATE_CURVE_INVALID");
    const quoteMetadata = await this.quoteReader.tokenMetadata(
      quoteToken as Address,
    );
    return {
      quoteToken,
      quoteSymbol: quoteMetadata.symbol,
      quoteDecimals: quoteMetadata.decimals,
      totalSupplyRaw,
      baseInventoryRaw,
      graduationThresholdRaw,
      destinationFeePips,
      terminalPriceToleranceBps,
      tradeFeeBps,
      creatorFeeShareBps,
      partnerFeeShareBps,
      protocolFeeShareBps,
      creatorLpShareBps,
      creatorLockSeconds,
      curveSegments,
    };
  }
  deploymentInfo(): DbcAddresses {
    return this.deployment;
  }
}
