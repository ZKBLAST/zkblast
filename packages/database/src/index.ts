import { createClient } from "@supabase/supabase-js";

export { IdentityRepository } from "./identity-repository.js";
export {
  normalizeWalletAddress,
  validateUsername,
} from "./identity-validation.js";
export type {
  TradeHistoryItem,
  UserProfile,
  UserWallet,
} from "./identity-repository.js";

export function createDatabaseClient(
  input: Readonly<{ url: string; key: string; schema: string }>,
) {
  if (!/^zkblast_(testnet|mainnet)$/u.test(input.schema)) {
    throw new Error(`Unsupported database schema: ${input.schema}`);
  }

  return createClient(input.url, input.key, { db: { schema: input.schema } });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
