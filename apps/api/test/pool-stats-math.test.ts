import assert from "node:assert/strict";
import test from "node:test";

import { dammTvlQuoteRaw } from "../src/postgres-protocol-read-store.js";

test("DAMM TVL respects address ordering and quote decimals", () => {
  assert.equal(
    dammTvlQuoteRaw({
      tokenXAddress: "0x0000000000000000000000000000000000000002",
      tokenYAddress: "0x0000000000000000000000000000000000000001",
      quoteAddress: "0x0000000000000000000000000000000000000001",
      tokenXDecimals: 18,
      tokenYDecimals: 6,
      quoteDecimals: 6,
      reserve0Raw: "1000000",
      reserve1Raw: "500000000000000000",
      spotPriceX18: "2000000000000000000",
    })?.toString(),
    "2000000",
  );
});

test("DAMM TVL is unavailable until both finalized reserves exist", () => {
  assert.equal(
    dammTvlQuoteRaw({
      tokenXAddress: "0x0000000000000000000000000000000000000001",
      tokenYAddress: "0x0000000000000000000000000000000000000002",
      quoteAddress: "0x0000000000000000000000000000000000000002",
      tokenXDecimals: 18,
      tokenYDecimals: 18,
      quoteDecimals: 18,
      reserve0Raw: null,
      reserve1Raw: "1",
      spotPriceX18: "1",
    }),
    null,
  );
});
