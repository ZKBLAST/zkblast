import assert from "node:assert/strict";
import test from "node:test";
import type postgres from "postgres";
import type { Address, Hex } from "viem";
import type { IndexedEvent } from "../src/domain.js";
import { persistDbcEvent } from "../src/persist-dbc-event.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}` as Hex;

function event(eventName: string, payload: IndexedEvent["payload"]): IndexedEvent {
  return {
    chainId: 999,
    blockNumber: 42n,
    blockHash: hash("b"),
    transactionHash: hash("c"),
    logIndex: 3,
    contractAddress: address("1"),
    kind: "launch",
    eventName,
    payload: { ...payload, blockTimestamp: "1700000000" },
  };
}

async function projectedTable(item: IndexedEvent): Promise<string> {
  const writes: string[] = [];
  const sql = {
    unsafe: async (query: string) => {
      writes.push(query);
      return [];
    },
  } as unknown as postgres.Sql;
  await persistDbcEvent(sql, "zkblast_hyperevm_mainnet", item, new Set([address("1")]));
  return writes.slice(1).join("\n");
}

test("chain-999 graduation readiness and adapter bindings use canonical projections", async () => {
  const readiness = await projectedTable(
    event("GraduationReady", {
      launchId: hash("1"),
      realQuoteReserveRaw: "100",
      thresholdRaw: "100",
    }),
  );
  assert.match(readiness, /dbc_graduation_readiness/u);
  assert.match(readiness, /on conflict\(chain_id,launch_id\)/u);

  const binding = await projectedTable(
    event("GraduationAdapterBound", {
      migrationId: hash("2"),
      adapter: address("2"),
      factory: address("3"),
      version: "1",
      mode: "0",
      configurationHash: hash("4"),
    }),
  );
  assert.match(binding, /dbc_graduation_adapter_bindings/u);
  assert.match(binding, /on conflict\(chain_id,migration_id\)/u);
});

test("legacy DBC and launchpad fee claims reconcile without conflating identities", async () => {
  const legacy = await projectedTable(
    event("FeeClaimed", {
      launchId: hash("1"),
      recipient: address("2"),
      allocation: "0",
      amountRaw: "7",
    }),
  );
  assert.match(legacy, /launchpad_fee_claim_receipts/u);

  const launchpad = await projectedTable(
    event("FeeClaimed", {
      snapshotId: hash("3"),
      launchpadId: "4",
      recipient: address("5"),
      pool: address("6"),
      asset: address("7"),
      amount: "8",
    }),
  );
  assert.match(launchpad, /launchpad_fee_claim_receipts/u);
  assert.match(launchpad, /on conflict\(chain_id,transaction_hash,log_index\)/u);
});

test("proof receipts are replay-safe and keyed by chain and log identity", async () => {
  const receipt = await projectedTable(
    event("ProofClaimVerified", {
      snapshotId: hash("1"),
      recipient: address("2"),
      nullifier: hash("3"),
      amount: "9",
      verifierVersion: "1",
    }),
  );
  assert.match(receipt, /launchpad_proof_receipts/u);
  assert.match(receipt, /on conflict\(chain_id,transaction_hash,log_index\)/u);
});

test("unregistered ERC-20 transfers do not stop DBC reconciliation", async () => {
  const queries: string[] = [];
  const sql = {
    unsafe: async (query: string) => {
      queries.push(query);
      return [];
    },
  } as unknown as postgres.Sql;

  const handled = await persistDbcEvent(
    sql,
    "zkblast_mainnet",
    event("Transfer", {
      from: address("2"),
      to: address("3"),
      value: "10",
    }),
    new Set([address("1")]),
  );

  assert.equal(handled, false);
  assert.equal(queries.some((query) => query.includes("dbc_holder_balances")), false);
});

test("launch-domain events owned by another projector are ignored", async () => {
  const queries: string[] = [];
  const sql = {
    unsafe: async (query: string) => {
      queries.push(query);
      return [];
    },
  } as unknown as postgres.Sql;

  const handled = await persistDbcEvent(
    sql,
    "zkblast_mainnet",
    event("PolicyReceiptRecorded", { receiptId: hash("9") }),
    new Set([address("1")]),
  );

  assert.equal(handled, false);
  assert.equal(queries.length, 0);
});
