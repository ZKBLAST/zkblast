import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import {
  IndexerService,
  MemoryIndexerRepository,
  type BlockEnvelope,
  type IndexedEvent,
} from "../src/index.js";

const hash = (value: number) =>
  `0x${value.toString(16).padStart(64, "0")}` as Hex;
const address = `0x${"1".padStart(40, "0")}` as Address;

function event(
  blockNumber: bigint,
  blockHash: Hex,
  transaction: number,
): IndexedEvent {
  return {
    chainId: 46630,
    blockNumber,
    blockHash,
    transactionHash: hash(transaction),
    logIndex: 0,
    contractAddress: address,
    kind: "swap",
    eventName: "Swap",
    payload: { amountIn: "100" },
  };
}

function block(
  number: number,
  blockHash = hash(number),
  parentHash = hash(number - 1),
): BlockEnvelope {
  return {
    number: BigInt(number),
    hash: blockHash,
    parentHash,
    events: [event(BigInt(number), blockHash, number)],
  };
}

test("duplicate ingestion stays idempotent and respects confirmations", async () => {
  const blocks = new Map(
    [block(1), block(2), block(3), block(4)].map((item) => [item.number, item]),
  );
  const reader = {
    head: async () => 5n,
    block: async (number: bigint) => blocks.get(number)!,
  };
  const repository = new MemoryIndexerRepository();
  const service = new IndexerService(46630, 1n, reader, repository);
  await service.sync(1n);
  await service.sync(1n);
  assert.equal(repository.events.size, 4);
  assert.equal((await repository.checkpoint(46630))?.blockNumber, 4n);
});

test("rewind and replay replaces orphaned events deterministically", async () => {
  const blocks = new Map(
    [block(1), block(2), block(3), block(4)].map((item) => [item.number, item]),
  );
  let head = 4n;
  const reader = {
    head: async () => head,
    block: async (number: bigint) => blocks.get(number)!,
  };
  const repository = new MemoryIndexerRepository();
  const service = new IndexerService(46630, 0n, reader, repository);
  await service.sync(1n);

  const replacement3 = block(3, hash(103), hash(2));
  const replacement4 = block(4, hash(104), hash(103));
  const replacement5 = block(5, hash(105), hash(104));
  blocks.set(3n, replacement3);
  blocks.set(4n, replacement4);
  blocks.set(5n, replacement5);
  head = 5n;
  await service.sync(1n);

  assert.equal(repository.events.size, 5);
  assert.equal(
    repository.events.get(`46630:${hash(3)}:0`)?.blockHash,
    hash(103),
  );
  assert.equal((await repository.checkpoint(46630))?.blockHash, hash(105));
});
