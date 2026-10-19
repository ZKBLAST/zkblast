import assert from "node:assert/strict";
import test from "node:test";

import {
  stockMarketClassification,
  stockMarketClassifications,
} from "../src/stock-market-classifications.js";

test("classifies only markets backed by explicit issuer evidence", () => {
  assert.equal(stockMarketClassification("AMD")?.region, "us");
  assert.equal(stockMarketClassification("baba")?.region, "china");
  assert.equal(stockMarketClassification("TSLA")?.region, "us");
  assert.equal(stockMarketClassification("BB"), null);
  assert.equal(stockMarketClassification("EWY"), null);
});

test("every classification retains auditable HTTPS provenance", () => {
  const records = stockMarketClassifications();
  assert.equal(records.length, 7);
  assert.equal(
    new Set(records.map(({ symbol }) => symbol)).size,
    records.length,
  );
  for (const record of records) {
    assert.equal(new URL(record.sourceUrl).protocol, "https:");
    assert.match(record.verifiedAt, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(record.basis.length >= 20);
  }
});
