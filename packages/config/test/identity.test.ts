import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createChainEntityIdentity,
  createChainObjectKey,
} from "../src/identity.js";

test("creates deterministic chain-qualified identities", () => {
  const address = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
  assert.deepEqual(createChainEntityIdentity(4_663, "token", address), {
    chainId: 4_663,
    kind: "token",
    identifier: address.toLowerCase(),
    key: `4663:token:${address.toLowerCase()}`,
  });
  assert.equal(
    createChainEntityIdentity(998, "launchpad", "00042").key,
    "998:launchpad:42",
  );
  assert.equal(
    createChainObjectKey(999, "pool", address),
    `hyperevm-mainnet/pool/${address.toLowerCase()}`,
  );
});

test("identical addresses on different chains never share a key", () => {
  const address = "0x1111111111111111111111111111111111111111";
  assert.notEqual(
    createChainEntityIdentity(4_663, "pool", address).key,
    createChainEntityIdentity(999, "pool", address).key,
  );
});

test("rejects unsupported chains and malformed identifiers", () => {
  assert.throws(() =>
    createChainEntityIdentity(1, "token", "0x1111111111111111111111111111111111111111"),
  );
  assert.throws(() => createChainEntityIdentity(998, "launchpad", "-1"));
  assert.throws(() => createChainEntityIdentity(998, "pool", "0x1234"));
});
