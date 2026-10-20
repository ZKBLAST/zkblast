import assert from "node:assert/strict";
import test from "node:test";
import { waitForReceipt } from "../src/lib/swap-flow";
import {
  transactionSuccessEvent,
  type TransactionSuccess,
} from "../src/lib/transaction-success";

test("only successful receipts publish a confirmation, with network and receipt details", async () => {
  const target = new EventTarget();
  const events: TransactionSuccess[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: target,
  });
  target.addEventListener(transactionSuccessEvent, (event) =>
    events.push((event as CustomEvent<TransactionSuccess>).detail),
  );
  const hash = `0x${"a".repeat(64)}`;
  const context = { chainId: 4663, action: "Swap" };
  try {
    await waitForReceipt(
      {
        request: async () => ({
          transactionHash: hash,
          status: "0x1",
          blockNumber: "0x10",
          gasUsed: "0x5208",
        }),
      },
      hash,
      1,
      context,
    );
    assert.deepEqual(events, [
      { hash, ...context, blockNumber: "0x10", gasUsed: "0x5208" },
    ]);
    await assert.rejects(
      waitForReceipt(
        { request: async () => ({ status: "0x0" }) },
        hash,
        1,
        context,
      ),
      /REVERTED/,
    );
    await assert.rejects(
      waitForReceipt({ request: async () => null }, hash, 1, context),
      /PENDING/,
    );
    assert.equal(events.length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
