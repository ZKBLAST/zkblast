import assert from "node:assert/strict";
import test from "node:test";
import { isAddress } from "viem";
import { normalizeSafeOwners } from "./private-v2-safe-owners.js";

test("every Safe owner uses EIP-55, never the Array.map index as a chain ID", () => {
  const owners = normalizeSafeOwners([
    "0x48e7bcfe8f469fbc72e6bcef0d0ce70d51ffbbed",
    "0x2e8ca95e429f34e6e876e078dcd8e51eb31645b9",
  ]);
  assert.deepEqual(owners, [
    "0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9",
    "0x48e7BcFE8F469FBc72E6BcEf0D0cE70d51FFBbed",
  ]);
  assert.ok(owners.every((address) => isAddress(address, { strict: true })));
});
test("duplicate Safe owners are rejected after normalization", () => {
  assert.throws(
    () =>
      normalizeSafeOwners([
        "0x48e7bcfe8f469fbc72e6bcef0d0ce70d51ffbbed",
        "0x48e7BcFE8F469FBc72E6BcEf0D0cE70d51FFBbed",
      ]),
    /DUPLICATE_SAFE_OWNER/u,
  );
});
