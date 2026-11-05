import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase());
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
const unsignedDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/u);

export const stockQuoteAvailabilitySchema = z.enum([
  "discovered",
  "verified",
  "eligible",
  "listed",
  "suspended",
  "disabled",
]);

export const stockQuoteMarketStateSchema = z.enum([
  "active",
  "after_hours",
  "closed",
  "halted",
  "degraded",
  "emergency",
]);

export const stockQuoteCatalogRecordSchema = z
  .object({
    chainId: z.literal(4663),
    issuerAssetId: bytes32Schema,
    contractAddress: addressSchema,
    symbol: z.string().trim().min(1).max(32),
    instrumentName: z.string().trim().min(1).max(160),
    issuerName: z.string().trim().min(1).max(160),
    tokenDecimals: z.number().int().min(0).max(36),
    currentMultiplier: unsignedDecimalSchema,
    pendingMultiplier: z.union([z.literal(""), unsignedDecimalSchema]),
    availability: stockQuoteAvailabilitySchema,
    marketState: stockQuoteMarketStateSchema,
    quoteTradingEnabled: z.boolean(),
    graduationEnabled: z.boolean(),
    priceFeedAddress: addressSchema.nullable(),
    maxOracleAgeSeconds: z.number().int().positive().nullable(),
    observedAt: z.string().datetime(),
    sourceHash: bytes32Schema,
  })
  .superRefine((record, context) => {
    if (
      (record.quoteTradingEnabled || record.graduationEnabled) &&
      record.availability !== "listed"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled capabilities require listed availability",
        path: ["availability"],
      });
    }
    if (
      (record.quoteTradingEnabled || record.graduationEnabled) &&
      (!record.priceFeedAddress || !record.maxOracleAgeSeconds)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled capabilities require an oracle policy",
        path: ["priceFeedAddress"],
      });
    }
    if (
      record.quoteTradingEnabled &&
      ["halted", "degraded", "emergency"].includes(record.marketState)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsafe market state cannot enable quote trading",
        path: ["marketState"],
      });
    }
  });

export type StockQuoteCatalogRecord = z.infer<
  typeof stockQuoteCatalogRecordSchema
>;

export const stockQuoteDestinationCapabilitySchema = z
  .object({
    chainId: z.literal(4663),
    capabilityId: bytes32Schema,
    quoteAssetAddress: addressSchema,
    migrationMode: z.enum(["damm", "dlmm"]),
    adapterAddress: addressSchema,
    factoryAddress: addressSchema,
    adapterVersion: z.number().int().positive(),
    adapterConfigurationHash: bytes32Schema,
    reviewReferenceHash: bytes32Schema,
    fundedAcceptanceHash: bytes32Schema.nullable(),
    registeredAt: z.string().datetime(),
    acceptedAt: z.string().datetime().nullable(),
    enabled: z.boolean(),
  })
  .superRefine((capability, context) => {
    if (capability.enabled && (!capability.fundedAcceptanceHash || !capability.acceptedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled destination requires funded acceptance evidence",
        path: ["fundedAcceptanceHash"],
      });
    }
  });

export type StockQuoteDestinationCapability = z.infer<
  typeof stockQuoteDestinationCapabilitySchema
>;
