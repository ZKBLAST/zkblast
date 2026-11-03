import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { IndexerService } from "../src/indexer-service.js";
import { MemoryIndexerRepository } from "../src/repository.js";
import type { BlockEnvelope, IndexedEvent } from "../src/domain.js";

const contract = "0x0000000000000000000000000000000000000001" as Address;
const hash = (chainId: number, value: number) =>
  `0x${(BigInt(chainId) * 1_000_000n + BigInt(value)).toString(16).padStart(64, "0")}` as Hex;

function indexedEvent(
  chainId: 998 | 999,
  blockNumber: number,
  blockHash: Hex,
  transaction = blockNumber,
): IndexedEvent {
  return {
    chainId,
    blockNumber: BigInt(blockNumber),
    blockHash,
    transactionHash: hash(0, transaction),
    logIndex: 0,
    contractAddress: contract,
    kind: "launch",
    eventName: "LaunchpadStatusUpdated",
    payload: { launchpadId: "1", status: "1", blockTimestamp: "1700000000" },
  };
}

function chainBlock(
  chainId: 998 | 999,
  number: number,
  parentHash = number === 1 ? hash(chainId, 0) : hash(chainId, number - 1),
  blockHash = hash(chainId, number),
  duplicateLog = false,
): BlockEnvelope {
  const event = indexedEvent(chainId, number, blockHash);
  return {
    number: BigInt(number),
    hash: blockHash,
    parentHash,
    events: duplicateLog ? [event, event] : [event],
  };
}

function reader(blocks: Map<bigint, BlockEnvelope>, head: () => bigint) {
  return {
    head: async () => head(),
    block: async (number: bigint) => {
      const value = blocks.get(number);
      if (!value) throw new Error("RPC_PARTIAL_PROVIDER_MISSING_BLOCK");
      return value;
    },
  };
}

test("chain-998 duplicate logs replay deterministically without colliding with chain 999", async () => {
  const repository = new MemoryIndexerRepository();
  const testnetBlocks = new Map(
    [chainBlock(998, 1, undefined, undefined, true), chainBlock(998, 2)].map(
      (block) => [block.number, block],
    ),
  );
  const mainnetBlocks = new Map(
    [chainBlock(999, 1), chainBlock(999, 2)].map((block) => [block.number, block]),
  );
  const testnet = new IndexerService(998, 0n, reader(testnetBlocks, () => 2n), repository);
  const mainnet = new IndexerService(999, 0n, reader(mainnetBlocks, () => 2n), repository);

  await testnet.sync(1n);
  await mainnet.sync(1n);
  assert.equal(repository.events.size, 4);
  assert.equal((await repository.checkpoint(998))?.blockNumber, 2n);
  assert.equal((await repository.checkpoint(999))?.blockNumber, 2n);

  const before = [...repository.events.keys()].filter((key) => key.startsWith("998:")).sort();
  await repository.rewind(998, 0n);
  await testnet.sync(1n);
  const replayed = [...repository.events.keys()].filter((key) => key.startsWith("998:")).sort();
  assert.deepEqual(replayed, before);
  assert.equal([...repository.events.keys()].filter((key) => key.startsWith("999:")).length, 2);
});

test("chain-998 reorg replaces only orphaned state and preserves chain 999", async () => {
  const repository = new MemoryIndexerRepository();
  const testnetBlocks = new Map(
    [chainBlock(998, 1), chainBlock(998, 2), chainBlock(998, 3)].map((block) => [block.number, block]),
  );
  let testnetHead = 3n;
  const testnet = new IndexerService(998, 0n, reader(testnetBlocks, () => testnetHead), repository);
  const mainnetBlocks = new Map([[1n, chainBlock(999, 1)]]);
  const mainnet = new IndexerService(999, 0n, reader(mainnetBlocks, () => 1n), repository);
  await testnet.sync(1n);
  await mainnet.sync(1n);

  const replacement2 = chainBlock(998, 2, hash(998, 1), hash(998, 102));
  const replacement3 = chainBlock(998, 3, replacement2.hash, hash(998, 103));
  const replacement4 = chainBlock(998, 4, replacement3.hash, hash(998, 104));
  testnetBlocks.set(2n, replacement2);
  testnetBlocks.set(3n, replacement3);
  testnetBlocks.set(4n, replacement4);
  testnetHead = 4n;
  await testnet.sync(1n);

  assert.equal((await repository.checkpoint(998))?.blockHash, replacement4.hash);
  assert.equal((await repository.checkpoint(999))?.blockHash, hash(999, 1));
  assert.equal(repository.blocks.get("998:2"), replacement2.hash);
});

test("RPC outage and partial-provider chain mismatch never advance chain-998 checkpoint", async () => {
  const repository = new MemoryIndexerRepository();
  const outage = new IndexerService(
    998,
    0n,
    {
      head: async () => 1n,
      block: async () => {
        throw new Error("RPC_UNAVAILABLE");
      },
    },
    repository,
  );
  await assert.rejects(outage.sync(1n), /RPC_UNAVAILABLE/u);
  assert.equal(await repository.checkpoint(998), null);

  const foreignBlock = chainBlock(999, 1);
  const partial = new IndexerService(
    998,
    0n,
    { head: async () => 1n, block: async () => foreignBlock },
    repository,
  );
  await assert.rejects(partial.sync(1n), /CHAIN_ID_MISMATCH/u);
  assert.equal(await repository.checkpoint(998), null);
});
