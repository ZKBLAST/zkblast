import type { Address, PublicClient } from "viem";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { fastCatchup } from "./fast-catchup.js";

/** Independent cursor for the late-added Assistance Fund deployment. */
export function assistanceFundSynchronizer(input: {
  client: PublicClient;
  databaseUrl: string;
  schema: string;
  chainId: number;
  registry: Address;
  addresses: Address[];
  deploymentBlock: number;
  confirmations: bigint;
  chunkSize: bigint;
  maximumBlocks: bigint;
}) {
  const repository = new PostgresIndexerRepository(
    input.databaseUrl,
    input.schema,
    `assistance-fund-${input.addresses[0]!.slice(2).toLowerCase()}`,
  );
  return {
    close: () => repository.close(),
    synchronize: () =>
      fastCatchup({
        client: input.client,
        repository,
        chainId: input.chainId,
        registry: input.registry,
        addresses: input.addresses,
        fromBlock: BigInt(input.deploymentBlock),
        confirmations: input.confirmations,
        chunkSize: input.chunkSize,
        maximumBlocks: input.maximumBlocks,
      }),
  };
}
