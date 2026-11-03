import type { PublicConfig } from "@/types/application";
import {
  getChainDescriptor,
  privateVaultV2ConfigSchema,
  privateV2ConfigIssue,
} from "@zkblast/config";

export function parsePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_NETWORK_CONFIG");
  const config = value as Record<string, unknown>;
  if (config.environment !== "testnet" && config.environment !== "mainnet")
    throw new Error("INVALID_NETWORK_ENVIRONMENT");
  if (typeof config.chainId !== "number")
    throw new Error("INVALID_NETWORK_CHAIN");
  const descriptor = getChainDescriptor(config.chainId);
  if (descriptor.environment !== config.environment)
    throw new Error("NETWORK_ENVIRONMENT_MISMATCH");
  if (config.shieldedV2 !== undefined) {
    const v2 = privateVaultV2ConfigSchema.parse(config.shieldedV2);
    const v1 = (config.shielded as { vaultAddress?: string } | undefined)
      ?.vaultAddress;
    if (
      privateV2ConfigIssue(config.environment, config.chainId, v2, v1)
    )
      throw new Error("V2_VAULT_NOT_ISOLATED");
  }
  if (config.chainName !== descriptor.name)
    throw new Error("INVALID_NETWORK_NAME");
  if (typeof config.explorerUrl !== "string")
    throw new Error("INVALID_NETWORK_EXPLORER");
  const explorerUrl = config.explorerUrl.replace(/\/$/u, "");
  if (descriptor.explorerUrl && explorerUrl !== descriptor.explorerUrl)
    throw new Error("INVALID_NETWORK_EXPLORER");
  if (!descriptor.explorerUrl && explorerUrl !== "")
    throw new Error("INVALID_NETWORK_EXPLORER");
  if (!config.capabilities || typeof config.capabilities !== "object")
    throw new Error("INVALID_NETWORK_CAPABILITIES");
  for (const [capability, enabled] of Object.entries(descriptor.capabilities)) {
    if ((config.capabilities as Record<string, unknown>)[capability] !== enabled)
      throw new Error("NETWORK_CAPABILITY_MISMATCH");
  }
  return value as PublicConfig;
}
