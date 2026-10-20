import assert from "node:assert/strict";
import test from "node:test";
import type postgres from "postgres";
import type { PublicClient } from "viem";
import { reconcileUserActivity } from "../src/reconcile-user-activity.js";

const owner = "0x0000000000000000000000000000000000000001" as const;
const manager = "0x0000000000000000000000000000000000000002" as const;
const pool = "0x0000000000000000000000000000000000000003" as const;
const hash = `0x${"a".repeat(64)}`;
function fixture() {
  const writes: { query: string; values: unknown[] }[] = [];
  const state = {
    owner: owner as string,
    originHash: hash,
    receiptHash: hash,
    swaps: false,
  };
  const sql = {
    unsafe: async (query: string, values: unknown[] = []) => {
      if (query.includes("select distinct"))
        return state.swaps
          ? [{ transaction_hash: hash, block_hash: hash, block_number: "1" }]
          : [];
      if (
        query.includes("from zkblast_mainnet.user_wallets") &&
        query.startsWith("select")
      )
        return [{ id: "wallet", user_id: "user", wallet_address: owner }];
      if (query.includes("from zkblast_mainnet.pools"))
        return [{ id: "pool", address: pool, pool_kind: "damm" }];
      if (query.includes("from zkblast_mainnet.protocol_events"))
        return [
          {
            payload: { positionId: "1" },
            block_number: "1",
            block_hash: state.originHash,
          },
        ];
      writes.push({ query, values });
      return [];
    },
  };
  const client = {
    getChainId: async () => 4663,
    getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash,
      timestamp: 1700000000n,
    }),
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "nextPositionId" ? 2n : [state.owner, pool, 0, 0, 100n],
    getTransactionReceipt: async () => ({
      status: "success",
      from: owner,
      blockHash: state.receiptHash,
      blockNumber: 1n,
      logs: [],
    }),
  };
  return {
    state,
    writes,
    input: {
      client: client as unknown as PublicClient,
      sql: sql as unknown as postgres.Sql,
      schema: "zkblast_mainnet",
      chainId: 4663,
      positionManager: manager,
    },
  };
}
test("positions retain the verified owner, raw shares and real origin timestamp", async () => {
  const f = fixture();
  const result = await reconcileUserActivity(f.input);
  assert.equal(result.positions, 1);
  const insert = f.writes.find((write) => write.query.includes("insert into"))!;
  assert.deepEqual(insert.values.slice(0, 5), [
    "user",
    "wallet",
    "pool",
    "1",
    "100",
  ]);
  assert.equal(
    (insert.values.at(-1) as Date).toISOString(),
    "2023-11-14T22:13:20.000Z",
  );
});
test("foreign or unauthenticated owners never create a user or inherit another wallet's position", async () => {
  const f = fixture();
  f.state.owner = manager;
  const result = await reconcileUserActivity(f.input);
  assert.equal(result.unlinkedOwners, 1);
  assert.equal(
    f.writes.some((write) => write.query.includes("insert into")),
    false,
  );
  assert.match(f.writes[0]!.query, /status='closed'/);
});
test("an orphaned origin cannot produce a position snapshot", async () => {
  const f = fixture();
  f.state.originHash = `0x${"b".repeat(64)}`;
  await assert.rejects(reconcileUserActivity(f.input), /POSITION_ORIGIN/);
  assert.equal(f.writes.length, 0);
});
test("a receipt on a different block cannot create user history", async () => {
  const f = fixture();
  f.state.swaps = true;
  f.state.receiptHash = `0x${"b".repeat(64)}`;
  await assert.rejects(reconcileUserActivity(f.input), /HISTORY_RECEIPT/);
  assert.equal(
    f.writes.some((write) => write.query.includes("trade_history")),
    false,
  );
});
