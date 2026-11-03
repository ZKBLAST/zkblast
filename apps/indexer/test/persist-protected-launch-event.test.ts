import assert from "node:assert/strict";
import test from "node:test";
import type postgres from "postgres";
import type { Address, Hex } from "viem";
import type { IndexedEvent } from "../src/domain.js";
import {
  persistProtectedLaunchEvent,
  reconcileProtectedGraduationAccounting,
} from "../src/persist-protected-launch-event.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}` as Hex;
const event = (eventName: string, payload: IndexedEvent["payload"]): IndexedEvent => ({
  chainId: 4663, blockNumber: 10n, blockHash: hash("b"), transactionHash: hash("c"),
  logIndex: 2, contractAddress: address("1"), kind: "launch", eventName,
  payload: { ...payload, blockTimestamp: "1700000000" },
});
async function queryFor(item: IndexedEvent): Promise<string> {
  const writes: string[] = [];
  const sql = { unsafe: async (query: string) => { writes.push(query); return []; } } as unknown as postgres.Sql;
  await persistProtectedLaunchEvent(sql, "zkblast_mainnet", item);
  return writes.join("\n");
}

test("persists policy and canonical launch idempotently", async () => {
  const policy = await queryFor(event("ProtectionPolicyCreated", {
    policyId:"1",familyId:hash("1"),policyHash:hash("2"),version:"1",protectionBlocks:"10",
    maxBuyBpsPerTransaction:"25",maxBuyBpsPerAddress:"100",initialFeeBps:"500",baseFeeBps:"100",lpLockSeconds:"86400",
  }));
  assert.match(policy, /protected_launch_policies/u);
  assert.match(policy, /on conflict\(chain_id,policy_id\)/u);
  const launch = await queryFor(event("ProtectedTokenLaunched", {
    launchId:hash("3"),templateId:"1",policyId:"1",policyHash:hash("2"),creator:address("2"),
    token:address("3"),virtualPool:address("4"),quoteToken:address("5"),protectionStartBlock:"10",
  }));
  assert.match(launch, /protected_launches/u);
});

test("resolves cumulative purchase by canonical token", async () => {
  const query = await queryFor(event("ProtectedPurchaseRecorded", {
    buyer:address("2"),amount:"5",cumulativeAmount:"10",
  }));
  assert.match(query, /protected_buy_allocations/u);
  assert.match(query, /token_address=\$9/u);
});

test("only creates protected graduation rows for protected launches", async () => {
  const query = await queryFor(event("GraduationAttemptStarted", {
    migrationId:hash("4"),launchId:hash("3"),sourcePool:address("4"),adapter:address("6"),attempt:"1",
  }));
  assert.match(query, /where exists\(select 1 from .*protected_launches/u);
  assert.match(query, /on conflict\(chain_id,migration_id\)/u);
});

test("persists complete canonical identity and duplicate warnings", async () => {
  const query = await queryFor(event("ProtectedLaunchIdentityRegistered", {
    launchId:hash("3"),canonicalHash:hash("4"),token:address("3"),pool:address("4"),
    nameCommitment:hash("5"),symbolCommitment:hash("6"),metadataHash:hash("7"),
    socialHash:hash("8"),tokenRuntimeCodeHash:hash("9"),launchpadId:"1",
    tokenTemplateVersion:"1",duplicateName:false,duplicateSymbol:true,
  }));
  assert.match(query, /protected_launch_identities/u);
  assert.match(query, /on conflict\(chain_id,launch_id\)/u);
});

test("uses contiguous policy bind parameters and normalizes DAMM bin id", async () => {
  const used = await queryFor(event("ProtectionPolicyUsed", { policyId:"1" }));
  assert.match(used, /transaction_hash=\$3/u);
  assert.doesNotMatch(used, /\$8/u);

  const parameters: unknown[][] = [];
  const sql = {
    unsafe: async (_query: string, values: unknown[]) => { parameters.push(values); return []; },
  } as unknown as postgres.Sql;
  await persistProtectedLaunchEvent(sql, "zkblast_mainnet", event("ProtectedAllocationRegistered", {
    migrationId:hash("4"),pool:address("4"),creator:address("2"),protocolRecipient:address("3"),
    creatorShares:"8",protocolShares:"2",creatorUnlockAt:"1700000100",isDlmm:false,binId:"0",
  }));
  assert.equal(parameters[0]?.[9], null);
});

test("opens and resolves a deterministic migration accounting alert", async () => {
  const writes: { query: string; values: unknown[] }[] = [];
  const sql = {
    unsafe: async (query: string, values: unknown[]) => { writes.push({ query, values }); return []; },
  } as unknown as postgres.Sql;
  const base = {
    chainId:4663,migrationId:hash("4"),launchId:hash("3"),destinationShares:10n,
    detectedBlock:10n,detectedAt:new Date("2026-11-03T00:00:00.000Z"),
  };
  assert.equal(await reconcileProtectedGraduationAccounting(sql,"zkblast_mainnet",{
    ...base,allocatedShares:9n,
  }), false);
  assert.match(writes[1]?.query ?? "", /MIGRATION_ACCOUNTING_MISMATCH/u);
  assert.equal(writes[1]?.values[1], `${hash("4")}:migration-accounting`);

  writes.length = 0;
  assert.equal(await reconcileProtectedGraduationAccounting(sql,"zkblast_mainnet",{
    ...base,allocatedShares:10n,
  }), true);
  assert.match(writes[1]?.query ?? "", /resolved=true/u);
});
