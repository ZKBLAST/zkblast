import assert from "node:assert/strict";
import { test } from "node:test";
import { SdkError, type SdkErrorCode } from "../src/errors.js";

test("exposes typed Elysium launch and execution errors", () => {
  const cases: readonly SdkErrorCode[] = [
    "WRONG_CHAIN",
    "UNSUPPORTED_QUOTE_ASSET",
    "INVALID_CURVE_CONFIG",
    "STALE_QUOTE",
    "GRADUATION_UNAVAILABLE",
    "INSUFFICIENT_HYPE",
    "CONTRACT_NOT_DEPLOYED",
  ];
  for (const code of cases) {
    const error = new SdkError(code, code);
    assert.equal(error.code, code);
    assert.equal(error.name, "SdkError");
  }
});
