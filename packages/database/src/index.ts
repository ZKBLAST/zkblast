import { createClient } from "@supabase/supabase-js";

export { IdentityRepository } from "./identity-repository.js";
export {
  normalizeWalletAddress,
  validateUsername,
} from "./identity-validation.js";
export type {
  TradeHistoryItem,
  UserProfile,
  UserWallet,
} from "./identity-repository.js";
export {
  ponsGraduatedMarketSchema,
  stockAssetResponseSchema,
  stockQuoteResponseSchema,
} from "./external-market-validation.js";
export type { PonsGraduatedMarket } from "./external-market-validation.js";
export {
  stockQuoteAvailabilitySchema,
  stockQuoteCatalogRecordSchema,
  stockQuoteMarketStateSchema,
} from "./stock-quote-assets.js";
export type { StockQuoteCatalogRecord } from "./stock-quote-assets.js";
export {
  stockQuoteDestinationCapabilitySchema,
} from "./stock-quote-assets.js";
export type {
  StockQuoteDestinationCapability,
} from "./stock-quote-assets.js";
export {
  contrastRatio,
  launchpadBrandingHash,
  launchpadBrandingSchema,
  launchpadSlugSchema,
  validateLaunchpadImage,
} from "./launchpad-branding.js";
export type {
  LaunchpadBranding,
  LaunchpadImage,
  LaunchpadImageKind,
} from "./launchpad-branding.js";

export function createDatabaseClient(
  input: Readonly<{ url: string; key: string; schema: string }>,
) {
  if (!/^zkblast_(testnet|mainnet)$/u.test(input.schema)) {
    throw new Error(`Unsupported database schema: ${input.schema}`);
  }

  return createClient(input.url, input.key, { db: { schema: input.schema } });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
