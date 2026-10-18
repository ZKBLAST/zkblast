import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { validateBlockForPersistence, type BlockEnvelope } from "../src/index.js";

const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const address = `0x${"1".repeat(40)}` as Address;

function validBlock(): BlockEnvelope {
  return {
    number: 12n,
    hash: hash("a"),
    parentHash: hash("b"),
    events: [{
      chainId: 46630,
      blockNumber: 12n,
      blockHash: hash("a"),
      transactionHash: hash("c"),
      logIndex: 0,
      contractAddress: address,
      kind: "swap",
      eventName: "Swap",
      payload: { amountIn: "100" },
    }],
  };
}

test("accepts a structurally valid block before persistence", () => {
  assert.equal(validateBlockForPersistence(validBlock(), 46630).number, 12n);
});

test("rejects a chain mismatch before persistence", () => {
  assert.throws(() => validateBlockForPersistence(validBlock(), 1), /EVENT_CHAIN_ID_MISMATCH/u);
});

test("rejects an event whose block hash does not match its envelope", () => {
  const block = validBlock();
  const invalid = { ...block, events: [{ ...block.events[0]!, blockHash: hash("d") }] };
  assert.throws(() => validateBlockForPersistence(invalid, 46630), /EVENT_BLOCK_HASH_MISMATCH/u);
});
