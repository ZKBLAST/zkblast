import type { PublicConfig } from "@/types/application";
import {
  privateVaultV2ConfigSchema,
  privateV2ConfigIssue,
} from "@zkblast/config";

const expectedChainIds = { testnet: 46_630, mainnet: 4_663 } as const;

export function parsePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_NETWORK_CONFIG");
  const config = value as Record<string, unknown>;
  if (config.environment !== "testnet" && config.environment !== "mainnet")
    throw new Error("INVALID_NETWORK_ENVIRONMENT");
  if (config.chainId !== expectedChainIds[config.environment])
    throw new Error("NETWORK_ENVIRONMENT_MISMATCH");
  if (config.shieldedV2 !== undefined) {
    const v2 = privateVaultV2ConfigSchema.parse(config.shieldedV2);
    const v1 = (config.shielded as { vaultAddress?: string } | undefined)
      ?.vaultAddress;
    if (
      privateV2ConfigIssue(config.environment, config.chainId as number, v2, v1)
    )
      throw new Error("V2_VAULT_NOT_ISOLATED");
  }
  if (typeof config.chainName !== "string" || config.chainName.length === 0)
    throw new Error("INVALID_NETWORK_NAME");
  if (typeof config.explorerUrl !== "string")
    throw new Error("INVALID_NETWORK_EXPLORER");
  const explorer = new URL(config.explorerUrl);
  if (explorer.protocol !== "https:")
    throw new Error("INVALID_NETWORK_EXPLORER");
  return value as PublicConfig;
}
