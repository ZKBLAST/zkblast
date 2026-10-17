import { loadServerConfig } from "@zkblast/config";
import { z } from "zod";
import { createApp } from "./app.js";
import { AuthService } from "./auth-service.js";
import { IdentityService } from "./identity-service.js";
import { PostgresAuthStore } from "./postgres-auth-store.js";

const serviceSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().url(),
});

const serverConfig = loadServerConfig(process.env);
const serviceConfig = serviceSchema.parse(process.env);
const directDatabaseUrl = z
  .string()
  .url()
  .parse(process.env.SUPABASE_DIRECT_DATABASE_URL);
const identityStore = new PostgresAuthStore(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
);
const authService = new AuthService(identityStore, {
  chainId: serverConfig.CHAIN_ID,
  domain: new URL(serviceConfig.WEB_ORIGIN).host,
  origin: serviceConfig.WEB_ORIGIN,
});
const identityService = new IdentityService(identityStore);
const app = createApp(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    chainName: serverConfig.CHAIN_NAME,
    explorerUrl: serverConfig.BLOCK_EXPLORER_URL,
    webOrigin: serviceConfig.WEB_ORIGIN,
  },
  { authService, identityService },
);

app.listen(serviceConfig.API_PORT, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      service: "api",
      status: "ready",
      environment: serverConfig.APP_ENV,
      chainId: serverConfig.CHAIN_ID,
      port: serviceConfig.API_PORT,
    }),
  );
});
