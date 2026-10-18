const encoder = new TextEncoder();
const decoder = new TextDecoder();
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const fieldPattern = /^(0|[1-9][0-9]*)$/u;
const storagePrefix = "zkblast:encrypted-notes:v1";

const encodeBase64 = (value: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(value)));
const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export type NoteEnvironment = "testnet" | "mainnet";
export type ShieldedNoteV1 = Readonly<{
  format: "zkblast-note";
  version: 1;
  environment: NoteEnvironment;
  chainId: number;
  vaultAddress: `0x${string}`;
  treeVersion: number;
  assetAddress: `0x${string}`;
  amountRaw: string;
  secret: string;
  nonce: string;
  commitment: string;
  leafIndex: number | null;
  transactionHash: `0x${string}` | null;
  createdAt: string;
  status: "prepared" | "submitted" | "unspent" | "spent";
}>;

export type Backup = Readonly<{
  format: "zkblast-note-backup";
  version: 1;
  environment: NoteEnvironment;
  chainId: number;
  salt: string;
  iv: string;
  ciphertext: string;
}>;

function backupHeader(
  backup: Pick<Backup, "format" | "version" | "environment" | "chainId">,
): Uint8Array {
  return encoder.encode(
    `${backup.format}:${backup.version}:${backup.environment}:${backup.chainId}`,
  );
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error("PASSPHRASE_TOO_SHORT");
  const base = await crypto.subtle.importKey(
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
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptNotes(
  notes: readonly ShieldedNoteV1[],
  passphrase: string,
  environment = notes[0]?.environment,
  chainId = notes[0]?.chainId,
): Promise<Backup> {
  if (!environment || !chainId) throw new Error("BACKUP_NETWORK_REQUIRED");
  const validated = notes.map((note) =>
    validateNote(note, { environment, chainId }),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: "zkblast-note-backup" as const,
    version: 1 as const,
    environment,
    chainId,
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: backupHeader(header) as BufferSource,
    },
    await deriveKey(passphrase, salt),
    encoder.encode(JSON.stringify(validated)),
  );
  return {
    ...header,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
  };
}

export async function decryptNotes(
  backup: Backup,
  passphrase: string,
  expected: Readonly<{ environment: NoteEnvironment; chainId: number }>,
): Promise<readonly ShieldedNoteV1[]> {
  if (!isBackup(backup)) throw new Error("INVALID_BACKUP");
  if (
    backup.environment !== expected.environment ||
    backup.chainId !== expected.chainId
  ) {
    throw new Error("BACKUP_NETWORK_MISMATCH");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(backup.iv) as BufferSource,
      additionalData: backupHeader(backup) as BufferSource,
    },
    await deriveKey(passphrase, decodeBase64(backup.salt)),
    decodeBase64(backup.ciphertext) as BufferSource,
  );
  const decoded: unknown = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(decoded)) throw new Error("INVALID_BACKUP_PAYLOAD");
  return decoded.map((note) => validateNote(note, expected));
}

export function validateNote(
  value: unknown,
  expected?: Readonly<{
    environment: NoteEnvironment;
    chainId: number;
    vaultAddress?: string;
  }>,
): ShieldedNoteV1 {
  if (!value || typeof value !== "object") throw new Error("INVALID_NOTE");
  const note = value as Record<string, unknown>;
  const valid =
    note.format === "zkblast-note" &&
    note.version === 1 &&
    (note.environment === "testnet" || note.environment === "mainnet") &&
    typeof note.chainId === "number" &&
    Number.isSafeInteger(note.chainId) &&
    note.chainId > 0 &&
    typeof note.vaultAddress === "string" &&
    addressPattern.test(note.vaultAddress) &&
    typeof note.treeVersion === "number" &&
    Number.isSafeInteger(note.treeVersion) &&
    note.treeVersion > 0 &&
    typeof note.assetAddress === "string" &&
    addressPattern.test(note.assetAddress) &&
    typeof note.amountRaw === "string" &&
    fieldPattern.test(note.amountRaw) &&
    BigInt(note.amountRaw) > 0n &&
    typeof note.secret === "string" &&
    fieldPattern.test(note.secret) &&
    BigInt(note.secret) > 0n &&
    typeof note.nonce === "string" &&
    fieldPattern.test(note.nonce) &&
    BigInt(note.nonce) > 0n &&
    typeof note.commitment === "string" &&
    fieldPattern.test(note.commitment) &&
    BigInt(note.commitment) > 0n &&
    (note.leafIndex === null ||
      (typeof note.leafIndex === "number" &&
        Number.isSafeInteger(note.leafIndex) &&
        note.leafIndex >= 0)) &&
    (note.transactionHash === null ||
      (typeof note.transactionHash === "string" &&
        /^0x[0-9a-fA-F]{64}$/u.test(note.transactionHash))) &&
    typeof note.createdAt === "string" &&
    !Number.isNaN(Date.parse(note.createdAt)) &&
    ["prepared", "submitted", "unspent", "spent"].includes(String(note.status));
  if (!valid) throw new Error("INVALID_NOTE");
  if (
    expected &&
    (note.environment !== expected.environment ||
      note.chainId !== expected.chainId)
  ) {
    throw new Error("NOTE_NETWORK_MISMATCH");
  }
  if (
    expected?.vaultAddress &&
    String(note.vaultAddress).toLowerCase() !==
      expected.vaultAddress.toLowerCase()
  ) {
    throw new Error("NOTE_VAULT_MISMATCH");
  }
  return value as ShieldedNoteV1;
}

export function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.format === "zkblast-note-backup" &&
    candidate.version === 1 &&
    (candidate.environment === "testnet" ||
      candidate.environment === "mainnet") &&
    typeof candidate.chainId === "number" &&
    Number.isSafeInteger(candidate.chainId) &&
    candidate.chainId > 0 &&
    typeof candidate.salt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

export function encryptedStorageKey(
  environment: NoteEnvironment,
  chainId: number,
  vaultAddress: string,
): string {
  if (!addressPattern.test(vaultAddress))
    throw new Error("INVALID_VAULT_ADDRESS");
  return `${storagePrefix}:${environment}:${chainId}:${vaultAddress.toLowerCase()}`;
}

export async function storeEncryptedNotes(
  storage: Pick<Storage, "setItem">,
  notes: readonly ShieldedNoteV1[],
  passphrase: string,
): Promise<void> {
  const first = notes[0];
  if (!first) throw new Error("NO_NOTES_TO_STORE");
  const backup = await encryptNotes(
    notes,
    passphrase,
    first.environment,
    first.chainId,
  );
  storage.setItem(
    encryptedStorageKey(first.environment, first.chainId, first.vaultAddress),
    JSON.stringify(backup),
  );
}

export async function loadEncryptedNotes(
  storage: Pick<Storage, "getItem">,
  passphrase: string,
  expected: Readonly<{
    environment: NoteEnvironment;
    chainId: number;
    vaultAddress: string;
  }>,
): Promise<readonly ShieldedNoteV1[]> {
  const serialized = storage.getItem(
    encryptedStorageKey(
      expected.environment,
      expected.chainId,
      expected.vaultAddress,
    ),
  );
  if (!serialized) return [];
  const parsed: unknown = JSON.parse(serialized);
  if (!isBackup(parsed)) throw new Error("INVALID_STORED_BACKUP");
  const notes = await decryptNotes(parsed, passphrase, expected);
  return notes.map((note) => validateNote(note, expected));
}

export function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
