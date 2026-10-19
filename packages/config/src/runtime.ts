import { z } from "zod";

const appEnvironmentSchema = z.enum(["testnet", "mainnet"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;
const chainIds: Readonly<Record<AppEnvironment, number>> = {
  testnet: 46_630,
  mainnet: 4_663,
};

const publicConfigSchema = z.object({
  APP_ENV: appEnvironmentSchema,
  CHAIN_ID: z.coerce.number().int().positive(),
  CHAIN_NAME: z.string().min(1),
  RPC_URL: z.string().url(),
  BLOCK_EXPLORER_URL: z.string().url(),
  DEPLOYMENT_MANIFEST_PATH: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SCHEMA: z.string().min(1),
});

const serverConfigSchema = publicConfigSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;

function assertEnvironmentBoundary(config: PublicConfig): void {
  const expectedChainId = chainIds[config.APP_ENV];
  if (config.CHAIN_ID !== expectedChainId) {
    throw new Error(
      `${config.APP_ENV} requires Robinhood chain ${expectedChainId}`,
    );
  }
  const expectedSchema = `zkblast_${config.APP_ENV}`;
  if (config.SUPABASE_SCHEMA !== expectedSchema) {
    throw new Error(
      `${config.APP_ENV} requires database schema ${expectedSchema}`,
    );
  }

  const expectedManifest = `deployments/${config.APP_ENV}/manifest.json`;
  if (config.DEPLOYMENT_MANIFEST_PATH !== expectedManifest) {
    throw new Error(`${config.APP_ENV} requires manifest ${expectedManifest}`);
  }
}

export function loadPublicConfig(input: Record<string, unknown>): PublicConfig {
  const config = publicConfigSchema.parse(input);
  assertEnvironmentBoundary(config);
  return config;
}

export function loadServerConfig(input: Record<string, unknown>): ServerConfig {
  const config = serverConfigSchema.parse(input);
  assertEnvironmentBoundary(config);
  return config;
}
