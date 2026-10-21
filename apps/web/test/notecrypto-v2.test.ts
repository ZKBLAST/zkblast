import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decryptNotesV2,
  encryptNotesV2,
  encryptedStorageKeyV2,
  storeEncryptedNotesV2,
  validateStoredNoteV2,
  type NoteScopeV2,
  type StoredNoteV2,
} from "../src/lib/notecrypto-v2";

const scope: NoteScopeV2 = {
  environment: "testnet",
  chainId: "46630",
  settlement: "0x0000000000000000000000000000000000001000",
  treeVersion: "2",
};
const note: StoredNoteV2 = {
  version: 2,
  scope,
  resource: {
    kind: "token",
    address: "0x0000000000000000000000000000000000002000",
  },
  amount: "1000000",
  secret: "42",
  nonce: "0",
  commitment: "123",
  role: "input",
};
const passphrase = "local-test-passphrase-only";

test("v2 encrypted roundtrip verifies every commitment and isolates v1 storage", async () => {
  const notes = [note, { ...note, commitment: "124", role: "refund" as const }];
  const backup = await encryptNotesV2(notes, passphrase, scope);
  let verified = 0;
  assert.deepEqual(
    await decryptNotesV2(
      JSON.stringify(backup),
      passphrase,
      scope,
      async () => {
        verified += 1;
        return true;
      },
    ),
    notes,
  );
  assert.equal(verified, 2);
  assert.match(encryptedStorageKeyV2(scope), /^zkblast:encrypted-notes:v2:/u);
  const writes = new Map<string, string>();
  await storeEncryptedNotesV2(
    {
      setItem: (key, value) => {
        writes.set(key, value);
      },
    },
    notes,
    passphrase,
    scope,
  );
  assert.equal(writes.size, 1);
  assert.ok(!writes.values().next().value?.includes('"secret"'));
});

test("v2 restoration rejects wrong password, network, tree, ciphertext and commitment", async () => {
  const backup = await encryptNotesV2([note], passphrase, scope);
  const serialized = JSON.stringify(backup);
  await assert.rejects(
    decryptNotesV2(serialized, "wrong-passphrase", scope, async () => true),
  );
  for (const changed of [
    { ...scope, environment: "mainnet" as const },
    { ...scope, chainId: "4663" },
    { ...scope, treeVersion: "3" },
  ]) {
    await assert.rejects(
      decryptNotesV2(serialized, passphrase, changed, async () => true),
    );
  }
  await assert.rejects(
    decryptNotesV2(
      JSON.stringify({
        ...backup,
        ciphertext: `${backup.ciphertext[0] === "A" ? "B" : "A"}${backup.ciphertext.slice(1)}`,
      }),
      passphrase,
      scope,
      async () => true,
    ),
  );
  await assert.rejects(
    decryptNotesV2(serialized, passphrase, scope, async () => false),
    /COMMITMENT_MISMATCH/u,
  );
});

test("v2 rejects legacy notes, invalid resources, numeric aliases and duplicate notes", async () => {
  for (const invalid of [
    { ...note, version: 1 },
    { ...note, amount: "01" },
    { ...note, secret: "0" },
    { ...note, resource: { ...note.resource, model: "damm" } },
    {
      ...note,
      resource: {
        kind: "lp",
        address: note.resource.address,
        model: "damm",
        binId: "1",
      },
    },
  ])
    assert.throws(() => validateStoredNoteV2(invalid, scope));
  await assert.rejects(
    encryptNotesV2([note, note], passphrase, scope),
    /DUPLICATE/u,
  );
  await assert.rejects(
    decryptNotesV2(
      JSON.stringify({ format: "zkblast-note-backup", version: 1 }),
      passphrase,
      scope,
      async () => true,
    ),
  );
});
