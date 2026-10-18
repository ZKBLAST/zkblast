import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  decryptNotes,
  encryptNotes,
  encryptedStorageKey,
  isBackup,
  loadEncryptedNotes,
  storeEncryptedNotes,
  validateNote,
  type ShieldedNoteV1,
} from "../src/lib/notecrypto.js";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const note: ShieldedNoteV1 = {
  format: "zkblast-note",
  version: 1,
  environment: "testnet",
  chainId: 46630,
  vaultAddress: `0x${"1".repeat(40)}`,
  treeVersion: 1,
  assetAddress: `0x${"2".repeat(40)}`,
  amountRaw: "1000000",
  secret: "123",
  nonce: "456",
  commitment: "789",
  leafIndex: null,
  transactionHash: null,
  createdAt: "2026-10-18T00:00:00.000Z",
  status: "prepared",
};

test("encrypts and restores a network-bound v1 note", async () => {
  const backup = await encryptNotes([note], "correct horse battery staple");
  assert.equal(isBackup(backup), true);
  const restored = await decryptNotes(backup, "correct horse battery staple", {
    environment: "testnet",
    chainId: 46630,
  });
  assert.deepEqual(restored, [note]);
});

test("rejects the wrong password and cross-network restore", async () => {
  const backup = await encryptNotes([note], "correct horse battery staple");
  await assert.rejects(
    decryptNotes(backup, "wrong password value", {
      environment: "testnet",
      chainId: 46630,
    }),
  );
  await assert.rejects(
    decryptNotes(backup, "correct horse battery staple", {
      environment: "mainnet",
      chainId: 1,
    }),
    /BACKUP_NETWORK_MISMATCH/u,
  );
});

test("rejects malformed and wrong-vault notes", () => {
  assert.throws(() => validateNote({ ...note, secret: "0" }), /INVALID_NOTE/u);
  assert.throws(
    () =>
      validateNote(note, {
        environment: "testnet",
        chainId: 46630,
        vaultAddress: `0x${"3".repeat(40)}`,
      }),
    /NOTE_VAULT_MISMATCH/u,
  );
  assert.match(
    encryptedStorageKey("testnet", 46630, note.vaultAddress),
    /testnet:46630/u,
  );
});

test("stores only ciphertext and validates the local vault scope", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  await storeEncryptedNotes(storage, [note], "correct horse battery staple");
  const serialized = [...values.values()][0] ?? "";
  assert.doesNotMatch(serialized, /"secret":"123"/u);
  const restored = await loadEncryptedNotes(
    storage,
    "correct horse battery staple",
    {
      environment: "testnet",
      chainId: 46630,
      vaultAddress: note.vaultAddress,
    },
  );
  assert.deepEqual(restored, [note]);
});
