import { formatUnits, parseUnits } from "viem";
import { z } from "zod";

const assetSchema = z.object({
  contractAddress: z.string(),
  symbol: z.string(),
  tokenDecimals: z.number().int().min(0).max(36),
  currentMultiplier: z.string(),
  availability: z.enum([
    "listed",
    "eligible",
    "verified",
    "discovered",
    "suspended",
    "disabled",
  ]),
  marketState: z.enum([
    "active",
    "after_hours",
    "closed",
    "halted",
    "degraded",
    "emergency",
  ]),
  quoteTradingEnabled: z.boolean(),
  graduationEnabled: z.boolean(),
  priceFeedAddress: z.string().nullable().optional(),
  maxOracleAgeSeconds: z.number().int().positive().nullable().optional(),
});

const destinationSchema = z.object({
  migrationMode: z.enum(["damm", "dlmm"]),
  enabled: z.boolean(),
});

export const stockQuotePreviewRequestSchema = z.object({
  contractAddress: z
    .string()
    .regex(/^0x[\da-f]{40}$/iu)
    .transform((value) => value.toLowerCase()),
  amountRaw: z.string().regex(/^\d+$/u),
  operation: z.enum([
    "create_launch",
    "fund",
    "buy",
    "sell",
    "graduate",
    "exit",
  ]),
  migrationMode: z.enum(["damm", "dlmm"]),
});

type PreviewReason =
  | "ASSET_NOT_LISTED"
  | "QUOTE_TRADING_DISABLED"
  | "GRADUATION_DISABLED"
  | "MARKET_SESSION_RESTRICTED"
  | "DESTINATION_DISABLED"
  | "ORACLE_NOT_CONFIGURED"
  | "VALIDATED_ORACLE_PRICE_UNAVAILABLE";

function operationAllowed(
  asset: z.infer<typeof assetSchema>,
  operation: z.infer<typeof stockQuotePreviewRequestSchema>["operation"],
) {
  if (asset.availability !== "listed") return false;
  if (operation === "graduate" && !asset.graduationEnabled) return false;
  if (
    ["create_launch", "fund", "buy"].includes(operation) &&
    !asset.quoteTradingEnabled
  ) {
    return false;
  }
  if (asset.marketState === "active") return true;
  if (asset.marketState === "after_hours")
    return operation === "sell" || operation === "exit";
  if (["closed", "halted", "degraded"].includes(asset.marketState)) {
    return operation === "sell" || operation === "exit";
  }
  return operation === "exit";
}

/** Builds a read-only, fail-closed policy preview from indexed and validated metadata. */
export function buildStockQuotePreview(
  input: Readonly<{
    asset: Readonly<Record<string, unknown>>;
    destinations: readonly Readonly<Record<string, unknown>>[];
    request: z.infer<typeof stockQuotePreviewRequestSchema>;
  }>,
) {
  const asset = assetSchema.parse(input.asset);
  const destinations = input.destinations.map((item) =>
    destinationSchema.parse(item),
  );
  const destination = destinations.find(
    (item) => item.migrationMode === input.request.migrationMode,
  );
  const amountRaw = BigInt(input.request.amountRaw);
  const multiplierX18 = parseUnits(asset.currentMultiplier, 18);
  const allowed = operationAllowed(asset, input.request.operation);
  const oracleConfigured = Boolean(
    asset.priceFeedAddress && asset.maxOracleAgeSeconds,
  );
  const reasons: PreviewReason[] = [];

  if (asset.availability !== "listed") reasons.push("ASSET_NOT_LISTED");
  if (
    ["create_launch", "fund", "buy"].includes(input.request.operation) &&
    !asset.quoteTradingEnabled
  ) {
    reasons.push("QUOTE_TRADING_DISABLED");
  }
  if (input.request.operation === "graduate" && !asset.graduationEnabled) {
    reasons.push("GRADUATION_DISABLED");
  }
  if (!allowed && !reasons.length) reasons.push("MARKET_SESSION_RESTRICTED");
  if (destination?.enabled !== true) reasons.push("DESTINATION_DISABLED");
  if (!oracleConfigured) reasons.push("ORACLE_NOT_CONFIGURED");
  else reasons.push("VALIDATED_ORACLE_PRICE_UNAVAILABLE");

  return {
    chainId: 4663,
    contractAddress: asset.contractAddress,
    symbol: asset.symbol,
    amountRaw: amountRaw.toString(),
    amount: formatUnits(amountRaw, asset.tokenDecimals),
    tokenDecimals: asset.tokenDecimals,
    multiplier: asset.currentMultiplier,
    multiplierX18: multiplierX18.toString(),
    marketState: asset.marketState,
    availability: asset.availability,
    operation: input.request.operation,
    operationAllowed: allowed,
    migrationMode: input.request.migrationMode,
    destinationEnabled: destination?.enabled === true,
    oracleConfigured,
    usdNotionalX18: null,
    executable: false,
    reasons,
  } as const;
}

export function applyValidatedStockQuoteObservation(
  preview: ReturnType<typeof buildStockQuotePreview>,
  observation: Readonly<{
    priceX18: string;
    notionalX18: string;
    updatedAt: string;
    roundId: string;
    marketState:
      "active" | "after_hours" | "closed" | "halted" | "degraded" | "emergency";
    multiplierX18: string;
  }>,
) {
  return {
    ...preview,
    marketState: observation.marketState,
    multiplierX18: observation.multiplierX18,
    oraclePriceX18: observation.priceX18,
    oracleUpdatedAt: observation.updatedAt,
    oracleRoundId: observation.roundId,
    usdNotionalX18: observation.notionalX18,
    executable:
      preview.operationAllowed &&
      preview.destinationEnabled &&
      preview.oracleConfigured,
    reasons: preview.reasons.filter(
      (reason) => reason !== "VALIDATED_ORACLE_PRICE_UNAVAILABLE",
    ),
  } as const;
}
