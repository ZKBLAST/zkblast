import { loadWebPublicConfig } from "@zkblast/config/web-public";

// This is the complete browser environment allowlist. All chain, RPC, deployment,
// wallet-provider, and database configuration stays behind the ZKBLAST API.
export const webPublicConfig = loadWebPublicConfig({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
