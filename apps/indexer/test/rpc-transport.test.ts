import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRpcFallbackUrls } from "../src/rpc-transport.js";

test("parses unique HTTPS fallback RPCs", () => {
  assert.deepEqual(
    parseRpcFallbackUrls(
      "https://rpc-a.example, https://rpc-b.example,https://rpc-a.example",
    ),
    ["https://rpc-a.example", "https://rpc-b.example"],
  );
});

test("rejects insecure remote fallback RPCs", () => {
  assert.throws(
    () => parseRpcFallbackUrls("http://rpc.example"),
    /INDEXER_RPC_FALLBACK_URL_INVALID/u,
  );
  assert.deepEqual(parseRpcFallbackUrls(""), []);
});
