import assert from "node:assert/strict";
import test from "node:test";
import {
  defineChain,
  type Account,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  boundedTransactions,
  receiptRecord,
  spentWei,
  type UpgradeJournal,
} from "../scripts/bounded-upgrade-transactions.js";

const hash = `0x${"1".repeat(64)}` as const;
const address = `0x${"1".repeat(40)}` as const;
const chain = defineChain({
  id: 31337,
  name: "Test",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:1"] } },
});

test("pending transactions reserve their full maximum fee", () => {
  const journal: UpgradeJournal = {
    plan: { capWei: "1000", gasPriceCapWei: "10" },
    steps: {
      pending: { hash, rawTransaction: "0x", maximumFeeWei: "200" },
    },
  };
  assert.equal(spentWei(journal), 200n);
});

test("total fee reservation rejects overspending before signing or broadcasting", async () => {
  const client = {
    getGasPrice: async () => 10n,
    estimateGas: async () => 100n,
  } as unknown as PublicClient;
  const journal: UpgradeJournal = {
    plan: { capWei: "1500", gasPriceCapWei: "10" },
    steps: {},
  };
  const send = boundedTransactions({
    client,
    chain,
    rpc: "http://127.0.0.1:1",
    journal,
    journalFile: "/tmp/unused-no-write.json",
    remainingReserve: () => 300n,
  });
  await assert.rejects(
    send("deploy", { address, type: "json-rpc" } as Account, { data: "0x" }),
    /TOTAL_FEE_CAP_EXCEEDED/u,
  );
  assert.deepEqual(journal.steps, {});
});

test("receipt accounting includes explicit additional data fees and reverted gas", () => {
  const receipt = receiptRecord({
    transactionHash: hash,
    blockHash: hash,
    blockNumber: 1n,
    gasUsed: 10n,
    effectiveGasPrice: 3n,
    status: "reverted",
    l1Fee: "0x2",
  } as unknown as TransactionReceipt);
  assert.equal(receipt.totalFeeWei, "32");
  assert.equal(receipt.status, "reverted");
  assert.equal(receipt.contractAddress, null);
});
