import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase());
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/u);
const deployment = z.object({
  contractAddress: address,
  chainId: z.literal(4663),
});

export const stockAssetResponseSchema = z.object({
  assets: z.array(
    z.object({
      id: z.string().regex(/^0x[0-9a-f]{64}$/u),
      tokenSymbol: z.string().trim().min(1).max(32),
      tokenName: z.string().trim().min(1).max(160),
      deployments: z.array(deployment).min(1),
      currentMultiplier: decimal,
      pendingMultiplier: z.union([z.literal(""), decimal]),
      logoUrl: z.string().url(),
      status: z.enum([
        "ASSET_STATUS_ACTIVE",
        "ASSET_STATUS_INACTIVE",
        "ASSET_STATUS_UNSPECIFIED",
      ]),
    }),
  ),
});

export const stockQuoteResponseSchema = z.object({
  quotes: z.array(
    z
      .object({
        tokenSymbol: z.string().trim().min(1).max(32),
        deployments: z.array(deployment).min(1),
        bid: decimal,
        ask: decimal,
        currency: z.literal("USD"),
        dailyTradingVolume: decimal,
        isTradingHalt: z.boolean(),
        generatedAt: z.string().datetime(),
      })
      .refine((quote) => Number(quote.ask) >= Number(quote.bid), {
        message: "ask must be greater than or equal to bid",
      }),
  ),
});

export const ponsGraduatedMarketSchema = z.object({
  chainId: z.literal(4663),
  factoryAddress: address,
  tokenAddress: address,
  poolIdentifier: z.string().trim().min(1).max(200),
  quoteAddress: address,
  name: z.string().trim().min(1).max(160),
  symbol: z.string().trim().min(1).max(32),
  decimals: z.number().int().min(0).max(255),
  pairedPrincipalRaw: z.string().regex(/^\d+$/u),
  graduationThresholdRaw: z.string().regex(/^[1-9]\d*$/u),
  graduated: z.literal(true),
  observedBlock: z.number().int().nonnegative(),
});

export type PonsGraduatedMarket = z.infer<typeof ponsGraduatedMarketSchema>;
