import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MiB

for (const env of ["mainnet", "testnet"]) {
  const dir = path.join(root, "apps/web/public/zk", env, "v2");
  const zkeyPath = path.join(dir, "action.zkey");
  const buffer = readFileSync(zkeyPath);
  const totalHash = createHash("sha256").update(buffer).digest("hex");
  console.log(`[${env}] original size: ${buffer.length}, sha256: ${totalHash}`);

  let offset = 0;
  let partIndex = 0;
  const parts = [];
  while (offset < buffer.length) {
    const end = Math.min(offset + CHUNK_SIZE, buffer.length);
    const chunk = buffer.subarray(offset, end);
    const partPath = path.join(dir, `action.zkey.part${partIndex}`);
    writeFileSync(partPath, chunk);
    parts.push(chunk);
    console.log(`  -> created part${partIndex}: ${chunk.length} bytes`);
    offset = end;
    partIndex++;
  }

  // Verify reassembly
  const reassembled = Buffer.concat(parts);
  const reassembledHash = createHash("sha256").update(reassembled).digest("hex");
  if (reassembledHash !== totalHash) {
    throw new Error(`Hash mismatch in ${env}! Expected ${totalHash}, got ${reassembledHash}`);
  }
  console.log(`[${env}] reassembly verification PASSED`);
}
