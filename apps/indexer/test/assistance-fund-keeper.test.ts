import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistanceFundKeeper,
  type AssistanceKeeperPort,
} from "../src/assistance-fund-keeper.js";

const candidate = (key: string) => ({
  idempotencyKey: key,
  routeId: `0x${"11".repeat(32)}` as const,
  amountIn: 100n,
});

test("simulates immediately, submits sequential nonces, and remains idempotent", async () => {
  const nonces: number[] = [];
  const port: AssistanceKeeperPort = {
    async discover() {
      return [candidate("a"), candidate("b")];
    },
    async simulate(item) {
      return { executable: true, transaction: { key: item.idempotencyKey } };
    },
    async pendingNonce() {
      return 7;
    },
    async submit(_transaction, nonce) {
      nonces.push(nonce);
      return `0x${"22".repeat(32)}`;
    },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.equal((await keeper.runOnce()).length, 2);
  assert.deepEqual(nonces, [7, 8]);
  assert.equal((await keeper.runOnce()).length, 0);
  assert.equal(keeper.metrics().submitted, 2);
});

test("treats stale market state as retryable without submitting", async () => {
  let submitted = false;
  const port: AssistanceKeeperPort = {
    async discover() {
      return [candidate("stale")];
    },
    async simulate() {
      return {
        executable: false,
        retryable: true,
        reason: "STALE_REFERENCE_PRICE",
      };
    },
    async pendingNonce() {
      return 1;
    },
    async submit() {
      submitted = true;
      return `0x${"33".repeat(32)}`;
    },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.deepEqual(await keeper.runOnce(), []);
  assert.equal(submitted, false);
  assert.equal(keeper.metrics().retryable, 1);
});

test("contains unexpected submission failures and continues discovery", async () => {
  const port: AssistanceKeeperPort = {
    async discover() {
      return [candidate("bad")];
    },
    async simulate() {
      return { executable: true, transaction: {} };
    },
    async pendingNonce() {
      return 1;
    },
    async submit() {
      throw new Error("SIGNER_UNAVAILABLE");
    },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.deepEqual(await keeper.runOnce(), []);
  assert.equal(keeper.metrics().failed, 1);
});

test("reuses the nonce through a fee-bumped replacement", async () => {
  const attempts: Array<readonly [number, string]> = [];
  const port: AssistanceKeeperPort = {
    async discover() {
      return [candidate("replace")];
    },
    async simulate() {
      return { executable: true, transaction: {} };
    },
    async pendingNonce() {
      return 9;
    },
    async submit(_transaction, nonce, mode) {
      attempts.push([nonce, mode]);
      if (mode === "initial") throw new Error("REPLACEMENT_UNDERPRICED");
      return `0x${"44".repeat(32)}`;
    },
  };
  const keeper = new AssistanceFundKeeper(port);
  assert.equal((await keeper.runOnce()).length, 1);
  assert.deepEqual(attempts, [
    [9, "initial"],
    [9, "replacement"],
  ]);
});
