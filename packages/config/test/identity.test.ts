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
  assert.notEqual(
    createChainEntityIdentity(99_801, "pool", address).key,
    createChainEntityIdentity(999, "pool", address).key,
  );
  assert.notEqual(
    createChainObjectKey(99_801, "pool", address),
    createChainObjectKey(998, "pool", address),
  );
});

test("identical numeric launchpad IDs stay isolated on Elysium", () => {
  assert.equal(
    createChainEntityIdentity(99_801, "launchpad", "0007").key,
    "99801:launchpad:7",
  );
  assert.equal(
    createChainObjectKey(99_801, "launchpad", 7n),
    "elysium-testnet/launchpad/7",
  );
  assert.notEqual(
    createChainObjectKey(99_801, "launchpad", 7n),
    createChainObjectKey(999, "launchpad", 7n),
  );
});

test("rejects unsupported chains and malformed identifiers", () => {
  assert.throws(() =>
    createChainEntityIdentity(1, "token", "0x1111111111111111111111111111111111111111"),
  );
  assert.throws(() => createChainEntityIdentity(998, "launchpad", "-1"));
  assert.throws(() => createChainEntityIdentity(998, "pool", "0x1234"));
});
