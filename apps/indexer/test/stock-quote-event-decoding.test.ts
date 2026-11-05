import assert from "node:assert/strict";
import test from "node:test";
import { protocolAbis } from "@zkblast/abi";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";

import { classifyProtocolEvent } from "../src/classifier.js";
import { persistStockQuoteEvent } from "../src/persist-stock-quote-event.js";
import type { IndexedEvent } from "../src/domain.js";

test("decodes and classifies stock quote policy events", () => {
  const asset = `0x${"11".repeat(20)}` as const;
  const issuerAssetId = `0x${"22".repeat(32)}` as const;
  const priceFeed = `0x${"33".repeat(20)}` as const;
  const configurationHash = `0x${"44".repeat(32)}` as const;
  const topics = encodeEventTopics({
    abi: protocolAbis.StockQuoteAssetRegistry,
    eventName: "QuoteAssetListed",
    args: { asset, issuerAssetId, priceFeed },
  });
  const data = encodeAbiParameters(parseAbiParameters("uint32,bytes32"), [
    1,
    configurationHash,
  ]);
  const decoded = decodeEventLog({
    abi: Object.values(protocolAbis).flat(),
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data,
  });
  assert.equal(decoded.eventName, "QuoteAssetListed");
  assert.equal(classifyProtocolEvent(decoded.eventName), "launch");
  assert.equal(classifyProtocolEvent("StockQuotePolicyBound"), "launch");
  assert.equal(classifyProtocolEvent("StockQuotePolicyValidated"), "swap");
});

test("persists versioned stock quote events idempotently", async () => {
  const calls: { query: string; parameters: readonly unknown[] }[] = [];
  const sql = {
    async unsafe(query: string, parameters: readonly unknown[] = []) {
      calls.push({ query, parameters });
      return [];
    },
  };
  const event: IndexedEvent = {
    chainId: 4663,
    blockNumber: 100n,
    blockHash: `0x${"55".repeat(32)}`,
    transactionHash: `0x${"66".repeat(32)}`,
    logIndex: 2,
    contractAddress: `0x${"77".repeat(20)}`,
    kind: "launch",
    eventName: "SessionPolicyUpdated",
    payload: {
      asset: `0x${"11".repeat(20)}`,
      version: "2",
      state: "0",
      multiplierX18: "1000412952576205964",
      observedAt: "1793836800",
      blockTimestamp: "1800000000",
    },
  };
  assert.equal(
    await persistStockQuoteEvent(sql as never, "zkblast_mainnet", event),
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.parameters[4], "2");
  assert.equal(calls[0]!.parameters[5], "session_updated");
  assert.equal(calls[0]!.parameters[10], "active");
  assert.equal(calls[0]!.parameters[11], "1000412952576205964");
  assert.ok(calls[0]!.parameters[12] instanceof Date);
});

test("persists DAMM and DLMM capability receipts independently", async () => {
  const calls: { query: string; parameters: readonly unknown[] }[] = [];
  const sql = {
    async unsafe(query: string, parameters: readonly unknown[] = []) {
      calls.push({ query, parameters });
      return [];
    },
  };
  const base: Omit<IndexedEvent, "eventName" | "payload"> = {
    chainId: 4663,
    blockNumber: 101n,
    blockHash: `0x${"12".repeat(32)}`,
    transactionHash: `0x${"13".repeat(32)}`,
    logIndex: 0,
    contractAddress: `0x${"14".repeat(20)}`,
    kind: "launch",
  };
  const capabilityId = `0x${"15".repeat(32)}`;
  assert.equal(
    await persistStockQuoteEvent(sql as never, "zkblast_mainnet", {
      ...base,
      eventName: "DestinationCapabilityRegistered",
      payload: {
        capabilityId,
        quoteAsset: `0x${"16".repeat(20)}`,
        adapter: `0x${"17".repeat(20)}`,
        factory: `0x${"18".repeat(20)}`,
        adapterVersion: "1",
        mode: "1",
        adapterConfigurationHash: `0x${"19".repeat(32)}`,
        reviewReferenceHash: `0x${"20".repeat(32)}`,
        blockTimestamp: "1800000100",
      },
    }),
    true,
  );
  assert.equal(calls[0]!.parameters[3], "dlmm");
  assert.equal(
    await persistStockQuoteEvent(sql as never, "zkblast_mainnet", {
      ...base,
      logIndex: 1,
      eventName: "DestinationCapabilityAccepted",
      payload: {
        capabilityId,
        fundedAcceptanceHash: `0x${"21".repeat(32)}`,
        blockTimestamp: "1800000200",
      },
    }),
    true,
  );
  assert.match(calls[1]!.query, /enabled=true/u);
});

test("persists launch-bound policy identity and execution receipts", async () => {
  const calls: { query: string; parameters: readonly unknown[] }[] = [];
  const sql = {
    async unsafe(query: string, parameters: readonly unknown[] = []) {
      calls.push({ query, parameters });
      return [];
    },
  };
  const base: Omit<IndexedEvent, "eventName" | "payload"> = {
    chainId: 4663,
    blockNumber: 102n,
    blockHash: `0x${"31".repeat(32)}`,
    transactionHash: `0x${"32".repeat(32)}`,
    logIndex: 3,
    contractAddress: `0x${"33".repeat(20)}`,
    kind: "launch",
  };
  const launchId = `0x${"34".repeat(32)}`;
  const quoteAsset = `0x${"35".repeat(20)}`;
  const policyIdentity = `0x${"36".repeat(32)}`;
  assert.equal(
    await persistStockQuoteEvent(sql as never, "zkblast_mainnet", {
      ...base,
      eventName: "StockQuotePolicyBound",
      payload: {
        launchId,
        quoteToken: quoteAsset,
        policyIdentity,
        blockTimestamp: "1800000300",
      },
    }),
    true,
  );
  assert.match(calls[0]!.query, /stock_quote_launch_policy_bindings/u);
  assert.equal(calls[0]!.parameters[3], policyIdentity);

  assert.equal(
    await persistStockQuoteEvent(sql as never, "zkblast_mainnet", {
      ...base,
      kind: "swap",
      logIndex: 4,
      eventName: "StockQuotePolicyValidated",
      payload: {
        launchId,
        quoteAsset,
        policyIdentity,
        isBuy: true,
        quoteAmountRaw: "1250000",
        blockTimestamp: "1800000301",
      },
    }),
    true,
  );
  assert.match(calls[1]!.query, /stock_quote_execution_receipts/u);
  assert.match(calls[1]!.query, /quote_token_decimals/u);
  assert.match(calls[1]!.query, /multiplier_x18/u);
  assert.equal(calls[1]!.parameters[6], true);
  assert.equal(calls[1]!.parameters[7], "1250000");
});
