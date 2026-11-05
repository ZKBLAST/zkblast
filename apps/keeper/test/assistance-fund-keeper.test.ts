import assert from "node:assert/strict";
import test from "node:test";
import { AssistanceFundKeeper, type AssistanceKeeperPort } from "../src/assistance-fund-keeper.js";

const candidate = (key: string) => ({ idempotencyKey: key, routeId: `0x${"11".repeat(32)}` as const, amountIn: 100n });

test("simulates before submission and remains idempotent", async () => {
  const nonces: number[] = [];
  const port: AssistanceKeeperPort = {
    async discover() { return [candidate("a"), candidate("b")]; },
    async simulate(item) { return { executable: true, transaction: { key: item.idempotencyKey } }; },
    async pendingNonce() { return 7; },
    async submit(_transaction, nonce) { nonces.push(nonce); return `0x${"22".repeat(32)}`; },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.equal((await keeper.runOnce()).length, 2);
  assert.deepEqual(nonces, [7, 8]);
  assert.equal((await keeper.runOnce()).length, 0);
});

test("does not submit retryable stale state", async () => {
  let submitted = false;
  const port: AssistanceKeeperPort = {
    async discover() { return [candidate("stale")]; },
    async simulate() { return { executable: false, retryable: true, reason: "STALE_REFERENCE_PRICE" }; },
    async pendingNonce() { return 1; },
    async submit() { submitted = true; return `0x${"33".repeat(32)}`; },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.deepEqual(await keeper.runOnce(), []);
  assert.equal(submitted, false);
  assert.equal(keeper.metrics().retryable, 1);
});
