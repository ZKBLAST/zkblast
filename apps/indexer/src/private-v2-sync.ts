import { keccak256, type Address, type PublicClient } from "viem";
import type { PrivateVaultV2Config } from "@zkblast/config";
import {
  verifyPrivateV2Deployment,
  type PrivateV2RpcRequest,
} from "@zkblast/config/node";
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
  deployment?: PrivateVaultV2Config | undefined;
  legacyVault?: string | undefined;
}) {
  if (!(
    (input.chainId === 46630 && input.schema === "zkblast_testnet") ||
    (input.chainId === 4663 && input.schema === "zkblast_mainnet")
  ))
    throw new Error("V2_INDEXER_NETWORK_SCHEMA_MISMATCH");
  if (
    input.chainId === 4663 &&
    (!input.deployment ||
      input.deployment.vault.toLowerCase() !== input.vault.toLowerCase() ||
      input.deployment.deploymentBlock !== input.deploymentBlock)
  )
    throw new Error("V2_MAINNET_VERIFIED_DEPLOYMENT_REQUIRED");
  const repository = new PostgresIndexerRepository(
    input.databaseUrl,
    input.schema,
    `shielded-v2-${input.vault.slice(2).toLowerCase()}`,
  );
  let verified = false;
  return {
    close: () => repository.close(),
    synchronize: async () => {
      if (!verified) {
        await verifyPrivateV2Deployment(
          {
            environment: input.chainId === 4663 ? "mainnet" : "testnet",
            chainId: input.chainId,
            config: input.deployment,
            legacyVault: input.legacyVault,
          },
          input.client.request as PrivateV2RpcRequest,
          keccak256,
        );
        verified = true;
      }
      return fastCatchup({
        client: input.client,
        repository,
        chainId: input.chainId,
        registry: input.registry,
        addresses: [input.vault],
        fromBlock: BigInt(input.deploymentBlock),
        confirmations: input.confirmations,
        chunkSize: input.chunkSize,
        maximumBlocks: input.maximumBlocks,
      });
    },
  };
}
