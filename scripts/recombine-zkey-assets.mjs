import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const env of ["mainnet", "testnet"]) {
  const dir = path.join(root, "apps/web/public/zk", env, "v2");
  const parts = [
    readFileSync(path.join(dir, "action.zkey.part0")),
    readFileSync(path.join(dir, "action.zkey.part1")),
    readFileSync(path.join(dir, "action.zkey.part2")),
  ];
  const reassembled = Buffer.concat(parts);
  const hash = createHash("sha256").update(reassembled).digest("hex");
  writeFileSync(path.join(dir, "action.zkey"), reassembled);
  console.log(`[${env}] Reassembled action.zkey (${reassembled.length} bytes, sha256: ${hash})`);
}
