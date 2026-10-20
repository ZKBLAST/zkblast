import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp("/private/tmp/zkblast-railway-mainnet-");
const output = path.join(temporary, "source");
await mkdir(output);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const candidates = new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: root, maxBuffer: 16 * 1024 * 1024,
}).toString().split("\0").filter(Boolean));
const inventory = [];
for (const relative of [...candidates].sort()) {
  if (/(?:^|\/)(?:\.git|node_modules|docs|evidence|reports|audit-artifacts|secrets|private|credentials|keys|keystores|target|out|cache|\.next|dist)(?:\/|$)/u.test(relative) ||
      /(?:^|\/)\.env[^/]*$/u.test(relative) || /\.(?:private|local)\.json$/u.test(relative) ||
      /\.(?:pem|key|p12|keystore|mnemonic|secret|secrets|age)$/u.test(relative) || relative.endsWith(".DS_Store")) continue;
  if (relative.startsWith("/") || relative.split("/").includes("..")) throw new Error("Unsafe source path");
  const location = path.join(root, relative);
  let metadata;
  try { metadata = await lstat(location); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (!metadata.isFile()) throw new Error(`Non-regular upload source rejected: ${relative}`);
  const bytes = await readFile(location);
  await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
  await writeFile(path.join(output, relative), bytes, { flag: "wx", mode: metadata.mode & 0o777 });
  inventory.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
}
for (const required of ["package.json", "pnpm-lock.yaml", "deployments/mainnet/manifest.json", "deployments/mainnet/shielded-beta-release.json"])
  if (!inventory.some((entry) => entry.path === required)) throw new Error(`Missing deployment source: ${required}`);
await writeFile(path.join(temporary, "upload-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ output, files: inventory.length, totalBytes: inventory.reduce((sum, entry) => sum + entry.bytes, 0),
  inventorySha256: hash(JSON.stringify(inventory)), sensitivePathsExcluded: true,
  notice: "Explicit source snapshot. No env, docs, recovery keys, private deployment journals or Git directory included." }, null, 2));
