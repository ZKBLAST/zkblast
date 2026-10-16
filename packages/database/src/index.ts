import { createClient } from "@supabase/supabase-js";

export function createDatabaseClient(
  input: Readonly<{ url: string; key: string; schema: string }>,
) {
  if (!/^zkblast_(testnet|mainnet)$/u.test(input.schema)) {
    throw new Error(`Unsupported database schema: ${input.schema}`);
  }

  return createClient(input.url, input.key, { db: { schema: input.schema } });
}
