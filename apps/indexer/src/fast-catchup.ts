import {
  decodeEventLog,
  getAddress,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { protocolAbis } from "@zkblast/abi";
import type { IndexerCheckpoint } from "./domain.js";
import type { IndexerRepository } from "./repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";
import { validateBlockForPersistence } from "./validation.js";

const registryAbi = parseAbi([
  "function isRegisteredPool(address) view returns (bool)",
]);
const combinedAbi = Object.values(protocolAbis).flat();

const retryableRpcError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("rate limited") ||
    message.includes("limit exceeded") ||
    message.includes("429") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
};

async function withRpcRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!retryableRpcError(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Sparse anchors prove the scanned ranges; no per-block RPC/SQL round trip for empty blocks. */
export async function fastCatchup(input: {
  client: PublicClient;
  repository: IndexerRepository;
  chainId: number;
  /** Required only when PoolCreated events may be discovered. */
  registry?: Address;
  addresses: Address[];
  fromBlock: bigint;
  confirmations?: bigint;
  chunkSize?: bigint;
  maximumBlocks?: bigint;
  rangeDelayMs?: number;
  onProgress?: (checkpoint: IndexerCheckpoint, finalized: bigint) => void;
  onDiscoveredLaunchContracts?: (addresses: readonly Address[]) => void;
}) {
  const { client, repository, chainId, addresses } = input;
  if ((await withRpcRetry(() => client.getChainId())) !== chainId)
    throw new Error("CATCHUP_CHAIN_MISMATCH");
  const confirmations = input.confirmations ?? 5n;
  const chunk = input.chunkSize ?? 2000n;
  const maximum = input.maximumBlocks ?? 3000000n;
  const rangeDelayMs = input.rangeDelayMs ?? 0;
  if (
    confirmations < 1n ||
    chunk < 1n ||
    chunk > 10000n ||
    maximum < 1n ||
    maximum > 10000000n ||
    !Number.isInteger(rangeDelayMs) ||
    rangeDelayMs < 0 ||
    rangeDelayMs > 10_000
  )
    throw new Error("INVALID_CATCHUP_BOUND");
  const head = await withRpcRetry(() =>
    client.getBlockNumber({ cacheTime: 0 }),
  );
  if (head < confirmations) return { blocks: 0, events: 0 };
  const finalized = head - confirmations;
  let checkpoint = await repository.checkpoint(chainId);
  const start = checkpoint ? checkpoint.blockNumber + 1n : input.fromBlock;
  const end =
    start + maximum - 1n < finalized ? start + maximum - 1n : finalized;
  const reader = new ViemChainReader(client, chainId, addresses);
  let processed = 0,
    events = 0;
  for (let from = start; from <= end; from += chunk) {
    const latest = await repository.checkpoint(chainId);
    if (latest && checkpoint && latest.blockNumber > checkpoint.blockNumber)
      checkpoint = latest;
    if (checkpoint) {
      const checkpointBlockNumber = checkpoint.blockNumber;
      const checkpointBlock = await withRpcRetry(() =>
        client.getBlock({ blockNumber: checkpointBlockNumber }),
      );
      if (
        checkpointBlock.hash?.toLowerCase() !==
        checkpoint.blockHash.toLowerCase()
      )
        throw new Error("CATCHUP_REORG_REQUIRES_REWIND");
    }
    const to = from + chunk - 1n < end ? from + chunk - 1n : end;
    const boundary = await withRpcRetry(() =>
      client.getBlock({ blockNumber: to }),
    );
    const logs = await withRpcRetry(() =>
      client.getLogs({
        address: [...addresses],
        fromBlock: from,
        toBlock: to,
      }),
    );
    // Discover pools created during a scanned range before capturing their same-range activity.
    const discovered: Address[] = [];
    const discoveredLaunchContracts: Address[] = [];
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: combinedAbi,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "TokenLaunched" ||
          decoded.eventName === "ProtectedTokenLaunched"
        ) {
          const args = decoded.args as { token: Address; virtualPool: Address };
          for (const candidate of [
            getAddress(args.token),
            getAddress(args.virtualPool),
          ]) {
            if (
              !addresses.some(
                (address) => address.toLowerCase() === candidate.toLowerCase(),
              ) &&
              !discoveredLaunchContracts.some(
                (address) => address.toLowerCase() === candidate.toLowerCase(),
              )
            )
              discoveredLaunchContracts.push(candidate);
          }
          continue;
        }
        if (decoded.eventName !== "PoolCreated") continue;
        const pool = getAddress(
          String((decoded.args as { pool: Address }).pool),
        );
        if (
          !addresses.some(
            (address) => address.toLowerCase() === pool.toLowerCase(),
          ) &&
          !discovered.includes(pool)
        )
          discovered.push(pool);
      } catch {
        /* Unrelated or unsupported events are not projected. */
      }
    }
    if (discoveredLaunchContracts.length > 0) {
      input.onDiscoveredLaunchContracts?.(discoveredLaunchContracts);
      for (const contract of discoveredLaunchContracts) {
        addresses.push(contract);
        logs.push(
          ...(await withRpcRetry(() =>
            client.getLogs({
              address: contract,
              fromBlock: from,
              toBlock: to,
            }),
          )),
        );
      }
    }
    for (const pool of discovered) {
      const registry = input.registry;
      if (!registry) throw new Error("CATCHUP_POOL_REGISTRY_REQUIRED");
      if (
        !(await withRpcRetry(() =>
          client.readContract({
            address: registry,
            abi: registryAbi,
            functionName: "isRegisteredPool",
            args: [pool],
          }),
        ))
      )
        throw new Error("CATCHUP_UNREGISTERED_POOL");
      addresses.push(pool);
      logs.push(
        ...(await withRpcRetry(() =>
          client.getLogs({
            address: pool,
            fromBlock: from,
            toBlock: to,
          }),
        )),
      );
    }
    const numbers = [
      ...new Set([
        ...logs
          .map((log) => log.blockNumber)
          .filter((n): n is bigint => n !== null),
        to,
      ]),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const blocks = [];
    for (const number of numbers) {
      const selected = logs.filter((log) => log.blockNumber === number);
      if (selected.some((log) => log.removed))
        throw new Error("CATCHUP_REMOVED_LOG");
      blocks.push(
        validateBlockForPersistence(
          await withRpcRetry(() => reader.block(number, selected)),
          chainId,
        ),
      );
    }
    if (
      !boundary.hash ||
      (await withRpcRetry(() => client.getBlock({ blockNumber: to }))).hash !==
        boundary.hash
    )
      throw new Error("CATCHUP_RANGE_CHANGED");
    for (const block of blocks) {
      if (checkpoint && block.number <= checkpoint.blockNumber) continue;
      const next = {
        chainId,
        blockNumber: block.number,
        blockHash: block.hash,
        finalizedBlock: block.number,
      };
      try {
        await repository.applyBlock(block, next);
        checkpoint = next;
        events += block.events.length;
      } catch (error) {
        const staleCheckpoint =
          error instanceof Error &&
          (error.message.includes("STALE_INDEXER_CHECKPOINT") ||
            ("code" in error && error.code === "40001"));
        if (!staleCheckpoint) throw error;
        const latest = await repository.checkpoint(chainId);
        if (!latest || latest.blockNumber < block.number) throw error;
        checkpoint = latest;
      }
    }
    processed += Number(to - from + 1n);
    if (checkpoint) input.onProgress?.(checkpoint, finalized);
    if (rangeDelayMs > 0 && to < end)
      await new Promise((resolve) => setTimeout(resolve, rangeDelayMs));
  }
  return {
    blocks: processed,
    events,
    indexedBlock: checkpoint?.blockNumber.toString() ?? null,
    finalizedBlock: finalized.toString(),
  };
}
