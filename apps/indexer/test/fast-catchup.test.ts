import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient, Hex } from "viem";
import { fastCatchup } from "../src/fast-catchup.js";
import { MemoryIndexerRepository } from "../src/repository.js";
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const address = "0x0000000000000000000000000000000000000001" as const;
function fixture() {
  let reads = 0;
  const client = {
    getChainId: async () => 4663,
    getBlockNumber: async () => 1005n,
    getLogs: async () => [],
    getBlock: async ({ blockNumber: n }: { blockNumber: bigint }) => {
      reads++;
      return {
        number: n,
        hash: hash(n),
        parentHash: hash(n - 1n),
        timestamp: 1700000000n,
      };
    },
  };
  return { client, reads: () => reads };
}
test("one thousand empty finalized blocks need only sparse anchor reads and resume idempotently", async () => {
  const f = fixture();
  const repository = new MemoryIndexerRepository();
  const input = {
    client: f.client as unknown as PublicClient,
    repository,
    chainId: 4663,
    registry: address,
    addresses: [address],
    fromBlock: 1n,
    chunkSize: 1000n,
  };
  const result = await fastCatchup(input);
  assert.equal(result.blocks, 1000);
  assert.equal((await repository.checkpoint(4663))?.blockNumber, 1000n);
  assert.ok(f.reads() < 10);
  assert.equal((await fastCatchup(input)).blocks, 0);
});
test("a failed range scan never advances its checkpoint", async () => {
  const f = fixture();
  f.client.getLogs = async () => {
    throw new Error("provider unavailable");
  };
  const repository = new MemoryIndexerRepository();
  await assert.rejects(
    fastCatchup({
      client: f.client as unknown as PublicClient,
      repository,
      chainId: 4663,
      registry: address,
      addresses: [address],
      fromBlock: 1n,
    }),
  );
  assert.equal(await repository.checkpoint(4663), null);
});
test("an orphaned checkpoint fails closed instead of skipping its history", async () => {
  const f = fixture();
  const repository = new MemoryIndexerRepository();
  await repository.applyBlock(
    { number: 10n, hash: hash(99n), parentHash: hash(9n), events: [] },
    {
      chainId: 4663,
      blockNumber: 10n,
      blockHash: hash(99n),
      finalizedBlock: 10n,
    },
  );
  await assert.rejects(
    fastCatchup({
      client: f.client as unknown as PublicClient,
      repository,
      chainId: 4663,
      registry: address,
      addresses: [address],
      fromBlock: 1n,
    }),
    /REORG/,
  );
  assert.equal((await repository.checkpoint(4663))?.blockNumber, 10n);
});
test("range bounds and chain identity are enforced", async () => {
  const f = fixture();
  const repository = new MemoryIndexerRepository();
  const input = {
    client: f.client as unknown as PublicClient,
    repository,
    chainId: 4663,
    registry: address,
    addresses: [address],
    fromBlock: 1n,
  };
  await assert.rejects(fastCatchup({ ...input, chainId: 46630 }), /CHAIN/);
  await assert.rejects(fastCatchup({ ...input, chunkSize: 10001n }), /BOUND/);
});
