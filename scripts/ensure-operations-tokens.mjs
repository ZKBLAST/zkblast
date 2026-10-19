import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";

for (const path of [".env.testnet", ".env.mainnet"]) {
  const content = await readFile(path, "utf8");
  const line = `OPERATIONS_API_TOKEN=${randomBytes(32).toString("base64url")}`;
  const next = /^OPERATIONS_API_TOKEN=.*$/mu.test(content)
    ? content.replace(/^OPERATIONS_API_TOKEN=.*$/mu, line)
    : `${content.replace(/\n*$/u, "\n")}${line}\n`;
  const temporary = `${path}.local`;
  await writeFile(temporary, next, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

console.log("Unique local operations tokens prepared without printing values");
