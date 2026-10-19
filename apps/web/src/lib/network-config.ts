import type { PublicConfig } from "@/types/application";

const expectedChainIds = { testnet: 46_630, mainnet: 4_663 } as const;

export function parsePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_NETWORK_CONFIG");
  const config = value as Record<string, unknown>;
  if (config.environment !== "testnet" && config.environment !== "mainnet")
    throw new Error("INVALID_NETWORK_ENVIRONMENT");
  if (config.chainId !== expectedChainIds[config.environment])
    throw new Error("NETWORK_ENVIRONMENT_MISMATCH");
  if (typeof config.chainName !== "string" || config.chainName.length === 0)
    throw new Error("INVALID_NETWORK_NAME");
  if (typeof config.explorerUrl !== "string")
    throw new Error("INVALID_NETWORK_EXPLORER");
  const explorer = new URL(config.explorerUrl);
  if (explorer.protocol !== "https:")
    throw new Error("INVALID_NETWORK_EXPLORER");
  return value as PublicConfig;
}
