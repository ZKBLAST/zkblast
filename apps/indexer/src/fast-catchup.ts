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

/** Sparse anchors prove the scanned ranges; no per-block RPC/SQL round trip for empty blocks. */
export async function fastCatchup(input: {
  client: PublicClient;
  repository: IndexerRepository;
  chainId: number;
  registry: Address;
  addresses: Address[];
  fromBlock: bigint;
  confirmations?: bigint;
  chunkSize?: bigint;
  maximumBlocks?: bigint;
  onProgress?: (checkpoint: IndexerCheckpoint, finalized: bigint) => void;
}) {
  const { client, repository, chainId, addresses } = input;
  if ((await client.getChainId()) !== chainId)
    throw new Error("CATCHUP_CHAIN_MISMATCH");
  const confirmations = input.confirmations ?? 5n;
  const chunk = input.chunkSize ?? 2000n;
  const maximum = input.maximumBlocks ?? 3000000n;
  if (
    confirmations < 1n ||
    chunk < 1n ||
    chunk > 10000n ||
    maximum < 1n ||
    maximum > 10000000n
  )
    throw new Error("INVALID_CATCHUP_BOUND");
  const head = await client.getBlockNumber({ cacheTime: 0 });
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
    if (
      checkpoint &&
      (
        await client.getBlock({ blockNumber: checkpoint.blockNumber })
      ).hash?.toLowerCase() !== checkpoint.blockHash.toLowerCase()
    )
      throw new Error("CATCHUP_REORG_REQUIRES_REWIND");
    const to = from + chunk - 1n < end ? from + chunk - 1n : end;
    const boundary = await client.getBlock({ blockNumber: to });
    const logs = await client.getLogs({
      address: [...addresses],
      fromBlock: from,
      toBlock: to,
    });
    // Discover pools created during a scanned range before capturing their same-range activity.
    const discovered: Address[] = [];
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: combinedAbi,
          data: log.data,
          topics: log.topics,
        });
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
    for (const pool of discovered) {
      if (
        !(await client.readContract({
          address: input.registry,
          abi: registryAbi,
          functionName: "isRegisteredPool",
          args: [pool],
        }))
      )
        throw new Error("CATCHUP_UNREGISTERED_POOL");
      addresses.push(pool);
      logs.push(
        ...(await client.getLogs({
          address: pool,
          fromBlock: from,
          toBlock: to,
        })),
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
          await reader.block(number, selected),
          chainId,
        ),
      );
    }
    if (
      !boundary.hash ||
      (await client.getBlock({ blockNumber: to })).hash !== boundary.hash
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
      await repository.applyBlock(block, next);
      checkpoint = next;
      events += block.events.length;
    }
    processed += Number(to - from + 1n);
    if (checkpoint) input.onProgress?.(checkpoint, finalized);
  }
  return {
    blocks: processed,
    events,
    indexedBlock: checkpoint?.blockNumber.toString() ?? null,
    finalizedBlock: finalized.toString(),
  };
}
