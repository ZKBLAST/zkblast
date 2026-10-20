import assert from "node:assert/strict";
import test from "node:test";
import {
  executeSwap,
  executeTransactions,
  swapErrorMessage,
  waitForReceipt,
  type PreparedTransaction,
} from "../src/lib/swap-flow.js";
import type { EthereumProvider } from "../src/types/application.js";

const transaction: PreparedTransaction = {
  to: "0x0000000000000000000000000000000000000001",
  data: "0x1234",
  value: "0x0",
};

test("wallet preview timeouts are recognized in nested provider errors without suggesting a resend", () => {
  const message = swapErrorMessage({
    data: {
      originalError: {
        message:
          "imageFail to create HTTPConnectionPool(host='api.rabbybase.blockchain', port=80): Read timed out",
      },
    },
  });
  assert.match(message, /wallet.*preview.*timed out/iu);
  assert.match(message, /status is not confirmed/iu);
  assert.match(message, /Do not bypass/iu);
  assert.doesNotMatch(message, /api\.rabbybase/iu);
});

test("a wallet submission error is never automatically retried", async () => {
  let sends = 0;
  const provider: EthereumProvider = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return "0xb626";
      if (method === "eth_sendTransaction") {
        sends++;
        throw new Error("HTTPConnectionPool read timed out");
      }
      return null;
    },
  };
  await assert.rejects(
    executeSwap(
      provider,
      "0xaccount",
      46630,
      transaction,
      transaction,
      () => {},
    ),
  );
  assert.equal(sends, 1);
});

test("wrong network switches before approval and swap", async () => {
  const calls: string[] = [];
  let sendCount = 0;
  const provider: EthereumProvider = {
    request: async ({ method }) => {
      calls.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_sendTransaction") {
        sendCount += 1;
        return `0xhash${sendCount}`;
      }
      if (method === "eth_getTransactionReceipt")
        return { transactionHash: `0xhash${sendCount}`, status: "0x1" };
      return null;
    },
  };
  const states: string[] = [];
  await executeSwap(
    provider,
    "0xaccount",
    46630,
    transaction,
    transaction,
    (state) => states.push(state),
  );
  assert.deepEqual(states, [
    "switching-network",
    "approving",
    "swapping",
    "confirmed",
  ]);
  assert.equal(
    calls.filter((method) => method === "eth_sendTransaction").length,
    2,
  );
});

test("position workflow executes each prepared transaction in order", async () => {
  let sends = 0;
  const provider: EthereumProvider = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return "0xb626";
      if (method === "eth_sendTransaction") return `0xposition${++sends}`;
      if (method === "eth_getTransactionReceipt")
        return { transactionHash: `0xposition${sends}`, status: "0x1" };
      return null;
    },
  };
  const states: string[] = [];
  const hash = await executeTransactions(
    provider,
    "0xaccount",
    46630,
    [transaction, transaction, transaction],
    (state) => states.push(state),
  );
  assert.equal(hash, "0xposition3");
  assert.equal(sends, 3);
  assert.deepEqual(states, [
    "submitting",
    "submitting",
    "submitting",
    "confirmed",
  ]);
});

test("failed and replaced transactions expose actionable recovery", async () => {
  const reverted: EthereumProvider = {
    request: async () => ({ transactionHash: "0xhash", status: "0x0" }),
  };
  await assert.rejects(
    waitForReceipt(reverted, "0xhash", 1),
    /TRANSACTION_REVERTED/u,
  );
  const missing: EthereumProvider = { request: async () => null };
  await assert.rejects(
    waitForReceipt(missing, "0xhash", 1),
    /PENDING_OR_REPLACED/u,
  );
  assert.match(
    swapErrorMessage(new Error("TRANSACTION_PENDING_OR_REPLACED")),
    /explorer/iu,
  );
});
