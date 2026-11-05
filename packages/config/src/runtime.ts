import { z } from "zod";
import { getChainDescriptor } from "./chains.js";

const appEnvironmentSchema = z.enum(["testnet", "mainnet"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;
const optionalUrlSchema = z.union([z.string().url(), z.literal("")]);
const optionalServerUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalAddressSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().regex(/^0x[\da-f]{40}$/iu, "Invalid EVM address").optional(),
);
const publicConfigSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  CHAIN_ID: z.coerce.number().int().positive(),
  CHAIN_NAME: z.string().min(1),
  RPC_URL: z.string().url(),
  BLOCK_EXPLORER_URL: optionalUrlSchema,
  DEPLOYMENT_MANIFEST_PATH: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SCHEMA: z.string().min(1),
});

const serverConfigSchema = publicConfigSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ELYSIUM_PRIVATE_RPC_URL: optionalServerUrlSchema,
  ELYSIUM_WS_RPC_URL: optionalServerUrlSchema,
  EXECUTION_RESERVE_ASSET_ADDRESS: optionalAddressSchema,
  GRADUATION_POOL_FACTORY_ADDRESS: optionalAddressSchema,
  GRADUATION_SWAP_ROUTER_ADDRESS: optionalAddressSchema,
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;

function assertEnvironmentBoundary(config: PublicConfig): void {
  const descriptor = getChainDescriptor(config.CHAIN_ID);
  if (config.APP_ENV !== descriptor.environment) {
    throw new Error(
      `${config.APP_ENV} cannot use ${descriptor.slug} (${descriptor.chainId})`,
    );
  }
  if (config.SUPABASE_SCHEMA !== descriptor.databaseSchema) {
    throw new Error(
      `${descriptor.slug} requires database schema ${descriptor.databaseSchema}`,
    );
  }
  if (config.CHAIN_NAME !== descriptor.name) {
    throw new Error(
      `${descriptor.slug} requires chain name ${descriptor.name}`,
    );
  }
  const explorerUrl = config.BLOCK_EXPLORER_URL.replace(/\/$/u, "");
  if (descriptor.explorerUrl && explorerUrl !== descriptor.explorerUrl) {
    throw new Error(
      `${descriptor.slug} requires explorer ${descriptor.explorerUrl}`,
    );
  }
  if (!descriptor.explorerUrl && explorerUrl) {
    throw new Error(
      `${descriptor.slug} does not have a validated explorer URL`,
    );
  }
  if (config.DEPLOYMENT_MANIFEST_PATH !== descriptor.deploymentManifestPath) {
    throw new Error(
      `${descriptor.slug} requires manifest ${descriptor.deploymentManifestPath}`,
    );
  }
}

function assertServerIntegrationBoundary(config: ServerConfig): void {
  const descriptor = getChainDescriptor(config.CHAIN_ID);
  const integrations = [
    config.EXECUTION_RESERVE_ASSET_ADDRESS,
    config.GRADUATION_POOL_FACTORY_ADDRESS,
    config.GRADUATION_SWAP_ROUTER_ADDRESS,
  ];

  if (!descriptor.capabilities.launchpad && integrations.some(Boolean)) {
    throw new Error(
      `${descriptor.slug} integration addresses are disabled until its launchpad capability is approved`,
    );
  }

  const hasElysiumProvider = Boolean(
    config.ELYSIUM_PRIVATE_RPC_URL || config.ELYSIUM_WS_RPC_URL,
  );
  if (descriptor.family !== "elysium" && hasElysiumProvider) {
    throw new Error(
      `${descriptor.slug} cannot use Elysium provider configuration`,
    );
  }
  if (
    descriptor.family === "elysium" &&
    !descriptor.publicRpcUrls.includes(config.RPC_URL)
  ) {
    throw new Error(
      `${descriptor.slug} RPC_URL must remain an approved public fallback; configure private access through ELYSIUM_PRIVATE_RPC_URL`,
    );
  }
}

export type ServerRpcSelection = Readonly<{
  httpUrl: string;
  websocketUrl?: string;
  usesPrivateProvider: boolean;
}>;

export function resolveServerRpcSelection(
  config: ServerConfig,
): ServerRpcSelection {
  const descriptor = getChainDescriptor(config.CHAIN_ID);
  if (descriptor.family !== "elysium") {
    return { httpUrl: config.RPC_URL, usesPrivateProvider: false };
  }
  return {
    httpUrl: config.ELYSIUM_PRIVATE_RPC_URL ?? config.RPC_URL,
    ...(config.ELYSIUM_WS_RPC_URL
      ? { websocketUrl: config.ELYSIUM_WS_RPC_URL }
      : {}),
    usesPrivateProvider: Boolean(config.ELYSIUM_PRIVATE_RPC_URL),
  };
}

export function loadPublicConfig(input: Record<string, unknown>): PublicConfig {
  const config = publicConfigSchema.parse(input);
  assertEnvironmentBoundary(config);
  return config;
}

export function loadServerConfig(input: Record<string, unknown>): ServerConfig {
  const config = serverConfigSchema.parse(input);
  assertEnvironmentBoundary(config);
  assertServerIntegrationBoundary(config);
  return config;
}
