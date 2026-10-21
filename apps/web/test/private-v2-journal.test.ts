import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptJournalV2,
  emptyJournalV2,
  journalStorageKeyV2,
  mergeJournalsV2,
  persistJournalV2,
  validateJournalV2,
  type PrivateJournalV2,
} from "../src/lib/private-v2-journal";
import {
  encryptPrivatePayloadV2,
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
  amount: "100",
  secret: "1234",
  nonce: "99",
  commitment: "11",
  role: "input",
};
const journal: PrivateJournalV2 = {
  ...emptyJournalV2(),
  notes: [
    note,
    { ...note, secret: "1235", commitment: "12", role: "output" },
    { ...note, secret: "1236", commitment: "13", role: "refund" },
  ],
  intents: [
    {
      id: `0x${"a".repeat(64)}`,
      action: "swap",
      inputs: ["11"],
      outputs: ["12"],
      refunds: ["13"],
      statement: "0x0102",
    },
  ],
};
const passphrase = "local-journal-test-passphrase";

test("journal roundtrip keeps outputs and refunds together without plaintext storage", async () => {
  const storage = new Map<string, string>();
  const result = await persistJournalV2(journal, passphrase, scope, {
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
    lock: async (_, work) => work(),
    verify: async () => true,
  });
  assert.deepEqual(result, journal);
  const ciphertext = storage.get(journalStorageKeyV2(scope))!;
  assert.ok(!ciphertext.includes("1234"));
  assert.deepEqual(
    await decryptJournalV2(ciphertext, passphrase, scope, async () => true),
    journal,
  );
  assert.deepEqual(mergeJournalsV2(journal, emptyJournalV2(), scope), journal);
  await assert.rejects(
    decryptJournalV2(ciphertext, passphrase, scope, async () => false),
    /COMMITMENT/u,
  );
  const notesPurpose = await encryptPrivatePayloadV2(
    journal,
    passphrase,
    scope,
    "notes",
  );
  await assert.rejects(
    decryptJournalV2(
      JSON.stringify(notesPurpose),
      passphrase,
      scope,
      async () => true,
    ),
  );
});

test("journal rejects missing refunds, duplicate reservations, forged resources and conflicting restore", () => {
  assert.throws(
    () =>
      validateJournalV2(
        { ...journal, notes: journal.notes.slice(0, 2) },
        scope,
      ),
    /RECOVERY/u,
  );
  assert.throws(
    () =>
      validateJournalV2(
        {
          ...journal,
          intents: [
            ...journal.intents,
            { ...journal.intents[0], id: `0x${"b".repeat(64)}` },
          ],
        },
        scope,
      ),
    /ALREADY_RESERVED/u,
  );
  assert.throws(
    () =>
      validateJournalV2(
        {
          ...journal,
          notes: journal.notes.map((item) =>
            item.role === "refund" ? { ...item, amount: "101" } : item,
          ),
        },
        scope,
      ),
    /REFUND_RESOURCE/u,
  );
  assert.throws(
    () =>
      mergeJournalsV2(
        journal,
        { ...emptyJournalV2(), notes: [{ ...note, secret: "999" }] },
        scope,
      ),
    /CONFLICT/u,
  );
});

test("failed storage write does not report a durable journal", async () => {
  await assert.rejects(
    persistJournalV2(journal, passphrase, scope, {
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QUOTA_EXCEEDED");
        },
      },
      lock: async (_, work) => work(),
      verify: async () => true,
    }),
    /QUOTA/u,
  );
});
