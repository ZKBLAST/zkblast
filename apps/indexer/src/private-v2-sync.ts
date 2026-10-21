import type { Address, PublicClient } from "viem";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { fastCatchup } from "./fast-catchup.js";

/** A late-added vault must not inherit the already-advanced protocol cursor. */
export function privateV2Synchronizer(input: {
  client: PublicClient;
  databaseUrl: string;
  schema: string;
  chainId: number;
  registry: Address;
  vault: Address;
  deploymentBlock: number;
  confirmations: bigint;
  chunkSize: bigint;
  maximumBlocks: bigint;
}) {
  if (input.chainId !== 46630 || input.schema !== "zkblast_testnet")
    throw new Error("V2_TESTNET_ONLY");
  const repository = new PostgresIndexerRepository(
    input.databaseUrl,
    input.schema,
    `shielded-v2-${input.vault.slice(2).toLowerCase()}`,
  );
  return {
    close: () => repository.close(),
    synchronize: () =>
      fastCatchup({
        client: input.client,
        repository,
        chainId: input.chainId,
        registry: input.registry,
        addresses: [input.vault],
        fromBlock: BigInt(input.deploymentBlock),
        confirmations: input.confirmations,
        chunkSize: input.chunkSize,
        maximumBlocks: input.maximumBlocks,
      }),
  };
}
