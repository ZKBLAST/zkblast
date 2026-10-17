// Encrypted note backup using the browser's Web Crypto (PBKDF2 + AES-GCM).
// Notes never leave the device; this only produces a file the user keeps.
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export type Backup = { format: "zkblast-note-backup"; version: 0; env: "testnet"; salt: string; iv: string; ct: string };

export async function encryptNotes(data: unknown, pass: string): Promise<Backup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(pass, salt), enc.encode(JSON.stringify(data)));
  return { format: "zkblast-note-backup", version: 0, env: "testnet", salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decryptNotes<T>(b: Backup, pass: string): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(b.iv) }, await key(pass, unb64(b.salt)), unb64(b.ct));
  return JSON.parse(dec.decode(pt)) as T;
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
