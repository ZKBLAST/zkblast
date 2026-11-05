import assert from "node:assert/strict";
import test from "node:test";
import { protocolAbis } from "@zkblast/abi";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";
import { isIndexerConsumer } from "../src/postgres-indexer-repository.js";
import { classifyProtocolEvent } from "../src/classifier.js";

test("Assistance Fund events are available to the shared indexer decoder", () => {
  const routeId = `0x${"11".repeat(32)}` as const;
  const assetIn = "0x0000000000000000000000000000000000000001" as const;
  const protocolToken = "0x0000000000000000000000000000000000000002" as const;
  const executor = "0x0000000000000000000000000000000000000003" as const;
  const topics = encodeEventTopics({
    abi: protocolAbis.AssistanceFund,
    eventName: "BuybackExecuted",
    args: { routeId, assetIn, protocolToken },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("uint256,uint256,uint256,uint256,address"),
    [29n, 2_860_000_000_000_000n, 10n ** 18n, 10n ** 18n, executor],
  );

  const decoded = decodeEventLog({
    abi: Object.values(protocolAbis).flat(),
    topics,
    data,
  });

  assert.equal(decoded.eventName, "BuybackExecuted");
  assert.equal((decoded.args as { amountIn: bigint }).amountIn, 29n);
  assert.equal(classifyProtocolEvent(decoded.eventName), "fee");
});

test("Assistance Fund backfill uses a bounded independent cursor", () => {
  assert.equal(isIndexerConsumer(`assistance-fund-${"ab".repeat(20)}`), true);
  assert.equal(
    isIndexerConsumer(`assistance-fund-v2-${"ab".repeat(20)}`),
    true,
  );
  assert.equal(isIndexerConsumer("assistance-fund-unbounded"), false);
});
