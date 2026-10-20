import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const folder = process.argv[2];
const expectedHash = process.argv[3];
if (!folder || !/^[a-f0-9]{64}$/u.test(expectedHash ?? ""))
  throw new Error(
    "Usage: node scripts/verify-zk-review-handoff.mjs <snapshot-folder> <out-of-band-snapshot-sha256>",
  );
const root = path.resolve(folder);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = JSON.parse(
  await readFile(path.join(root, "inventory.json"), "utf8"),
);
if (
  !Array.isArray(inventory.entries) ||
  inventory.schemaVersion !== 1 ||
  digest(JSON.stringify(inventory.entries)) !== expectedHash ||
  inventory.snapshotSha256 !== expectedHash
)
  throw new Error("HANDOFF_INVENTORY_HASH_MISMATCH");
const seen = new Set();
for (const entry of inventory.entries) {
  if (
    typeof entry.path !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/u.test(entry.path) ||
    entry.path.startsWith("/") ||
    entry.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    seen.has(entry.path)
  )
    throw new Error("HANDOFF_UNSAFE_OR_DUPLICATE_PATH");
  seen.add(entry.path);
  let location = path.join(root, "source");
  if (!(await lstat(location)).isDirectory())
    throw new Error("HANDOFF_SOURCE_NOT_DIRECTORY");
  for (const part of entry.path.split("/")) {
    location = path.join(location, part);
    if ((await lstat(location)).isSymbolicLink())
      throw new Error("HANDOFF_SYMLINK_REJECTED");
  }
  if (!(await lstat(location)).isFile())
    throw new Error("HANDOFF_NOT_REGULAR_FILE");
  const bytes = await readFile(location);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
    throw new Error(`HANDOFF_FILE_MISMATCH: ${entry.path}`);
}
console.log(
  JSON.stringify(
    {
      verified: true,
      files: seen.size,
      snapshotSha256: expectedHash,
      scope:
        "Inventory/file integrity only; not an audit, identity verification or ceremony approval",
    },
    null,
    2,
  ),
);
