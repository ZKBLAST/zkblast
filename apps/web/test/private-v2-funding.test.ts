import assert from "node:assert/strict";
import test from "node:test";
import type { EthereumProvider } from "../src/types/application";
import {
  assertPrivateWalletV2,
  sendPrivateTransactionV2,
} from "../src/lib/private-v2-funding";

const account = "0x0000000000000000000000000000000000001000";
const vault = "0x0000000000000000000000000000000000002000";
const hash = `0x${"a".repeat(64)}`;

test("private transaction simulates before signature and persists the hash before receipt polling", async () => {
  const order: string[] = [];
  const provider: EthereumProvider = {
    request: async ({ method }) => {
      order.push(method);
      if (method === "eth_chainId") return "0xb626";
      if (method === "eth_accounts") return [account];
      if (method === "eth_call") return "0x";
      if (method === "eth_sendTransaction") return hash;
      if (method === "eth_getTransactionReceipt")
        return { transactionHash: hash, status: "0x1" };
      throw new Error("UNEXPECTED_METHOD");
    },
  };
  assert.equal(
    await sendPrivateTransactionV2(
      provider,
      account,
      "46630",
      vault,
      "0x0102",
      "Local test",
      async () => {
        order.push("journal-hash-saved");
      },
    ),
    hash,
  );
  assert.deepEqual(order, [
    "eth_chainId",
    "eth_accounts",
    "eth_call",
    "eth_sendTransaction",
    "journal-hash-saved",
    "eth_getTransactionReceipt",
  ]);
});

test("wrong network/account and failed simulation never request a transaction signature", async () => {
  for (const failure of ["network", "account", "simulation"]) {
    let signatures = 0;
    const provider: EthereumProvider = {
      request: async ({ method }) => {
        if (method === "eth_chainId")
          return failure === "network" ? "0x1237" : "0xb626";
        if (method === "eth_accounts")
          return failure === "account" ? [] : [account];
        if (method === "eth_call") throw new Error("SIMULATION_REVERTED");
        if (method === "eth_sendTransaction") signatures += 1;
        return null;
      },
    };
    await assert.rejects(
      sendPrivateTransactionV2(
        provider,
        account,
        "46630",
        vault,
        "0x0102",
        "Local test",
      ),
    );
    assert.equal(signatures, 0);
  }
  await assert.rejects(
    assertPrivateWalletV2({ request: async () => "0x1" }, account, "46630"),
  );
});
