import assert from "node:assert/strict";
import { test } from "node:test";
import {
  derivedLaunchCreate2Salt,
  launchIdentifier,
} from "../src/deterministic.js";

const base = {
  factory: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  templateId: 1n,
  salt: `0x${"33".repeat(32)}`,
} as const;

test("launch identity changes with the selected chain domain", () => {
  const robinhood = launchIdentifier({ ...base, chainId: 4663 });
  const hyperEvm = launchIdentifier({ ...base, chainId: 999 });
  assert.notEqual(robinhood, hyperEvm);
  assert.notEqual(
    derivedLaunchCreate2Salt(hyperEvm, "TOKEN"),
    derivedLaunchCreate2Salt(hyperEvm, "VIRTUAL_POOL"),
  );
});

test("deterministic helpers reject unknown chains and malformed salts", () => {
  assert.throws(() => launchIdentifier({ ...base, chainId: 1 }));
  assert.throws(() => launchIdentifier({ ...base, chainId: 999, salt: "0x01" }));
});
