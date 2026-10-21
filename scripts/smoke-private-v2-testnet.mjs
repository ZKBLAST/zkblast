import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// No wallet, signatures, writes, or private values are exposed by this HTTP check.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.APP_ENV !== "testnet" || process.env.CHAIN_ID !== "46630")
  throw new Error("TESTNET_ONLY");
const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: path.join(root, "apps/api"),
  env: {
    ...process.env,
    PORT: "3411",
    API_PORT: "3411",
    WEB_ORIGIN: "http://localhost:3410",
  },
  stdio: "ignore",
});
const web = spawn(
  "pnpm",
  ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3410"],
  {
    cwd: path.join(root, "apps/web"),
    env: { ...process.env, API_URL: "http://127.0.0.1:3411" },
    stdio: "ignore",
  },
);
async function wait(url) {
  for (let i = 0; i < 45; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("LOCAL_HTTP_NOT_READY");
}
try {
  const config = await (
    await wait("http://127.0.0.1:3410/api/v1/config")
  ).json();
  const actual = config.shieldedV2 ?? config.config?.shieldedV2;
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "deployments/testnet/manifest.json"),
      "utf8",
    ),
  );
  if (!actual || JSON.stringify(actual) !== JSON.stringify(manifest.shieldedV2))
    throw new Error("PUBLIC_V2_CONFIG_MISMATCH");
  const bytes = Buffer.from(
    await (
      await wait(`http://127.0.0.1:3410${actual.proverRelease.manifestPath}`)
    ).arrayBuffer(),
  );
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (hash(bytes) !== actual.proverRelease.manifestSha256)
    throw new Error("HTTP_MANIFEST_HASH_MISMATCH");
  const release = JSON.parse(bytes.toString());
  for (const asset of [
    release.noteCalculator,
    ...Object.values(release.action.assets),
    ...Object.values(release.fund.assets),
  ]) {
    const response = await wait(`http://127.0.0.1:3410${asset.path}`);
    if (hash(Buffer.from(await response.arrayBuffer())) !== asset.sha256)
      throw new Error("HTTP_ASSET_HASH_MISMATCH");
  }
  for (const worker of ["private-v2-worker.js", "private-v2-note-worker.js"])
    await wait(`http://127.0.0.1:3410/zk/${worker}`);
  console.log(
    "PASS: local web → API v2 configuration, pinned manifest, seven HTTP asset hashes and both worker URLs. No wallet transaction or Railway deployment.",
  );
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_]+$/u.test(error.message)
      ? error.message
      : "LOCAL_V2_SMOKE_FAILED",
  );
  process.exitCode = 1;
} finally {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
}
