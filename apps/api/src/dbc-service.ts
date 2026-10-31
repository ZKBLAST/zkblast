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
      Readonly<{ search?: string | undefined; lifecycle?: number | undefined }>,
  ): Promise<readonly unknown[]>;
  launch(launchId: string): Promise<unknown>;
  trades(launchId: string, page: DbcPage): Promise<readonly unknown[]>;
  candles(launchId: string, query: DbcCandleQuery): Promise<readonly unknown[]>;
  graduation(launchId: string): Promise<unknown>;
  saveMetadata(input: DbcLaunchMetadata): Promise<void>;
  metadata(metadataId: string): Promise<DbcLaunchMetadata | null>;
}
export interface DbcQuoteReader {
  quote(
    input: Readonly<{ pool: Address; side: "buy" | "sell"; amountRaw: bigint }>,
  ): Promise<unknown>;
  templateEconomics(templateId: bigint): Promise<unknown>;
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
      Readonly<{ search?: string | undefined; lifecycle?: number | undefined }>,
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
  quote(pool: Address, side: "buy" | "sell", amountRaw: bigint) {
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
    return {
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
    };
  }
  deploymentInfo(): DbcAddresses {
    return this.deployment;
  }
}
