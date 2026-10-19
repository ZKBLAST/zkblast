import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import {
  MemoryIndexerRepository,
  transactionObservation,
  type BlockEnvelope,
  type IndexedEvent,
} from "../src/index.js";

const hash = (value: string) => `0x${value.padStart(64, "0")}` as Hex;
const address = `0x${"1".padStart(40, "0")}` as Address;

function receipt(status: "success" | "reverted"): IndexedEvent {
  return {
    chainId: 46_630,
    blockNumber: 10n,
    blockHash: hash("10"),
    transactionHash: hash("20"),
    logIndex: 1_000_000,
    contractAddress: address,
    kind: "receipt",
    eventName: "TransactionReceipt",
    payload: { status, gasUsed: "21000", effectiveGasPrice: "10000000" },
  };
}

test("normalizes successful and reverted receipts", () => {
  assert.equal(transactionObservation(receipt("success"))?.status, "confirmed");
  assert.equal(transactionObservation(receipt("reverted"))?.status, "reverted");
  assert.throws(() =>
    transactionObservation({
      ...receipt("success"),
      payload: {
        status: "success",
        gasUsed: "invalid",
        effectiveGasPrice: "1",
      },
    }),
  );
});

test("receipt replay is idempotent and rewind removes orphaned state", async () => {
  const repository = new MemoryIndexerRepository();
  const event = receipt("success");
  const block: BlockEnvelope = {
    number: 10n,
    hash: event.blockHash,
    parentHash: hash("9"),
    events: [event],
  };
  const checkpoint = {
    chainId: 46_630,
    blockNumber: 10n,
    blockHash: event.blockHash,
    finalizedBlock: 9n,
  };

  await repository.applyBlock(block, checkpoint);
  await repository.applyBlock(block, checkpoint);
  assert.equal(repository.transactions.size, 1);
  assert.equal(
    repository.transactions.get(`46630:${event.transactionHash}`)?.gasUsed,
    "21000",
  );

  await repository.rewind(46_630, 10n);
  assert.equal(repository.transactions.size, 0);
});
