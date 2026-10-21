import { isPrivateV2Network } from "@zkblast/config";
import {
  assertCanonicalFieldV2,
  shieldedNoteWitnessV2,
  type ShieldedNoteV2,
} from "@zkblast/sdk";

export type NoteScopeV2 = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: string;
  settlement: `0x${string}`;
  treeVersion: string;
}>;

export type StoredNoteV2 = Readonly<{
  version: 2;
  scope: NoteScopeV2;
  resource: Readonly<{
    kind: "token" | "lp";
    address: `0x${string}`;
    model?: "damm" | "dlmm";
    binId?: string;
  }>;
  amount: string;
  secret: string;
  nonce: string;
  commitment: string;
  role: "input" | "output" | "refund";
}>;

type BackupV2 = Readonly<{
  format: "zkblast-note-backup";
  version: 2;
  scope: NoteScopeV2;
  salt: string;
  iv: string;
  ciphertext: string;
}>;

const encoder = new TextEncoder();
const MAX_NOTES = 512;
const MAX_BACKUP_BYTES = 2_000_000;
const decimal = /^(0|[1-9][0-9]{0,77})$/u;
const address = /^0x[0-9a-fA-F]{40}$/u;

function integer(value: unknown): bigint {
  if (typeof value !== "string" || !decimal.test(value))
    throw new Error("INVALID_V2_INTEGER");
  return BigInt(value);
}

function scopeKey(scope: NoteScopeV2): string {
  if (
    !scope ||
    !isPrivateV2Network(scope.environment, scope.chainId) ||
    !address.test(scope.settlement) ||
    BigInt(scope.settlement) === 0n ||
    integer(scope.chainId) <= 0n ||
    integer(scope.chainId) >= 2n ** 64n ||
    integer(scope.treeVersion) <= 0n ||
    integer(scope.treeVersion) >= 2n ** 64n
  )
    throw new Error("INVALID_V2_SCOPE");
  return `${scope.environment}:${scope.chainId}:${scope.settlement.toLowerCase()}:${scope.treeVersion}`;
}

export function encryptedStorageKeyV2(scope: NoteScopeV2): string {
  return `zkblast:encrypted-notes:v2:${scopeKey(scope)}`;
}

export function validateStoredNoteV2(
  value: unknown,
  scope: NoteScopeV2,
): StoredNoteV2 {
  if (!value || typeof value !== "object") throw new Error("INVALID_V2_NOTE");
  const note = value as StoredNoteV2;
  if (note.version !== 2 || scopeKey(note.scope) !== scopeKey(scope))
    throw new Error("V2_NOTE_SCOPE_MISMATCH");
  if (!["input", "output", "refund"].includes(note.role))
    throw new Error("INVALID_V2_NOTE_ROLE");
  const resource = note.resource;
  if (!resource || (resource.kind !== "token" && resource.kind !== "lp"))
    throw new Error("INVALID_V2_RESOURCE");
  if (
    resource.kind === "token" &&
    (resource.model !== undefined || resource.binId !== undefined)
  )
    throw new Error("INVALID_V2_TOKEN_RESOURCE");
  if (
    resource.kind === "lp" &&
    (typeof resource.binId !== "string" ||
      !/^-?(0|[1-9][0-9]{0,7})$/u.test(resource.binId))
  )
    throw new Error("INVALID_V2_BIN");
  const witness: ShieldedNoteV2 = {
    schemaVersion: 2,
    chainId: integer(scope.chainId),
    settlement: scope.settlement,
    treeVersion: integer(scope.treeVersion),
    resource:
      resource.kind === "token"
        ? { kind: "token", address: resource.address }
        : {
            kind: "lp",
            address: resource.address,
            model: resource.model!,
            binId: BigInt(resource.binId!),
          },
    amount: integer(note.amount),
    secret: integer(note.secret),
    nonce: integer(note.nonce),
  };
  shieldedNoteWitnessV2(witness);
  const commitment = integer(note.commitment);
  assertCanonicalFieldV2(commitment);
  if (commitment === 0n) throw new Error("INVALID_V2_COMMITMENT");
  // Return an allowlisted copy: never persist extra caller-supplied properties.
  return {
    version: 2,
    scope: { ...scope },
    resource:
      resource.kind === "token"
        ? { kind: "token", address: resource.address }
        : {
            kind: "lp",
            address: resource.address,
            model: resource.model,
            binId: resource.binId,
          },
    amount: note.amount,
    secret: note.secret,
    nonce: note.nonce,
    commitment: note.commitment,
    role: note.role,
  };
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}

function bytes(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > MAX_BACKUP_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  )
    throw new Error("INVALID_V2_BACKUP_ENCODING");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function key(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 1024)
    throw new Error("INVALID_V2_PASSPHRASE_LENGTH");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 600_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function validateNotes(
  notes: readonly unknown[],
  scope: NoteScopeV2,
): StoredNoteV2[] {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES)
    throw new Error("INVALID_V2_NOTE_COUNT");
  const validated = notes.map((note) => validateStoredNoteV2(note, scope));
  if (
    new Set(validated.map((note) => note.commitment)).size !== validated.length
  )
    throw new Error("DUPLICATE_V2_NOTE");
  return validated;
}

export async function encryptNotesV2(
  notes: readonly StoredNoteV2[],
  passphrase: string,
  scope: NoteScopeV2,
): Promise<BackupV2> {
  return encryptPrivatePayloadV2(
    validateNotes(notes, scope),
    passphrase,
    scope,
    "notes",
  );
}

/** Versioned encrypted container; consumers must validate their own decoded schema. */
export async function encryptPrivatePayloadV2(
  payload: unknown,
  passphrase: string,
  scope: NoteScopeV2,
  purpose: "notes" | "journal",
): Promise<BackupV2> {
  const plaintext = encoder.encode(JSON.stringify(payload));
  if (plaintext.length > 1_000_000) throw new Error("V2_BACKUP_TOO_LARGE");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(
        `zkblast-note-backup:2:${scopeKey(scope)}${purpose === "journal" ? ":journal" : ""}`,
      ),
    },
    await key(passphrase, salt),
    plaintext,
  );
  return {
    format: "zkblast-note-backup",
    version: 2,
    scope: { ...scope },
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}

/** Restore is atomic: all commitments must be recomputed locally before any note is accepted. */
export async function decryptNotesV2(
  serialized: string,
  passphrase: string,
  scope: NoteScopeV2,
  verifyCommitment: (note: StoredNoteV2) => Promise<boolean>,
): Promise<readonly StoredNoteV2[]> {
  const decoded = await decryptPrivatePayloadV2(
    serialized,
    passphrase,
    scope,
    "notes",
  );
  if (!Array.isArray(decoded)) throw new Error("INVALID_V2_BACKUP_PAYLOAD");
  const notes = validateNotes(decoded, scope);
  for (const note of notes) {
    if (!(await verifyCommitment(note)))
      throw new Error("V2_NOTE_COMMITMENT_MISMATCH");
  }
  return notes;
}

export async function decryptPrivatePayloadV2(
  serialized: string,
  passphrase: string,
  scope: NoteScopeV2,
  purpose: "notes" | "journal",
): Promise<unknown> {
  if (serialized.length > MAX_BACKUP_BYTES)
    throw new Error("V2_BACKUP_TOO_LARGE");
  const backup = JSON.parse(serialized) as BackupV2;
  if (
    !backup ||
    backup.format !== "zkblast-note-backup" ||
    backup.version !== 2 ||
    scopeKey(backup.scope) !== scopeKey(scope)
  )
    throw new Error("V2_BACKUP_SCOPE_MISMATCH");
  const salt = bytes(backup.salt);
  const iv = bytes(backup.iv);
  const ciphertext = bytes(backup.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16)
    throw new Error("INVALID_V2_BACKUP");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: encoder.encode(
        `zkblast-note-backup:2:${scopeKey(scope)}${purpose === "journal" ? ":journal" : ""}`,
      ),
    },
    await key(passphrase, salt),
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

/** Call and await before requesting a reservation signature; includes both output and refund notes. */
export async function storeEncryptedNotesV2(
  storage: Pick<Storage, "setItem">,
  notes: readonly StoredNoteV2[],
  passphrase: string,
  scope: NoteScopeV2,
): Promise<void> {
  const backup = await encryptNotesV2(notes, passphrase, scope);
  storage.setItem(encryptedStorageKeyV2(scope), JSON.stringify(backup));
}
