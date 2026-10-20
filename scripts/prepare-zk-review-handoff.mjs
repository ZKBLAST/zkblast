import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = [
  "packages/contracts/src",
  "packages/contracts/test",
  "packages/circuits/src",
  "packages/circuits/architecture",
  "packages/circuits/vectors/v1",
  "packages/circuits/browser",
  "packages/circuits/test",
  "packages/circuits/scripts",
  "packages/config/src",
  "packages/config/test",
  "packages/sdk/src",
  "packages/sdk/test",
  "apps/web/src/components/shielded",
  "packages/contracts/scripts",
  "packages/contracts/storage-layout",
  "packages/contracts/lib/poseidon2-solidity/src",
  "packages/abi/src",
  "apps/web/test",
];
const files = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "packages/contracts/package.json",
  "packages/contracts/foundry.toml",
  "packages/contracts/tsconfig.json",
  "packages/config/tsconfig.json",
  "packages/sdk/tsconfig.json",
  "packages/abi/package.json",
  "packages/abi/tsconfig.json",
  "packages/contracts/lib/poseidon2-solidity/LICENSE",
  "packages/contracts/lib/poseidon2-solidity/UPSTREAM.md",
  "packages/circuits/package.json",
  "packages/config/package.json",
  "packages/sdk/package.json",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/src/hooks/useShieldedProver.ts",
  "apps/web/src/app/shielded/ShieldedView.tsx",
  "apps/web/src/lib/shielded-prover.ts",
  "apps/web/src/lib/shielded-withdraw.ts",
  "apps/web/src/lib/shielded-deposit.ts",
  "apps/web/src/lib/notecrypto.ts",
  "apps/web/src/lib/note-circuit.ts",
  "apps/web/src/types/application.ts",
  "apps/web/src/lib/swap-flow.ts",
  "apps/web/src/lib/api-client.ts",
  "apps/web/src/data/testnet-prover-release.json",
  "apps/api/src/shielded-service.ts",
  "apps/api/src/shielded-router.ts",
  "apps/api/src/index.ts",
  "apps/indexer/src/runner.ts",
  "deployments/testnet/manifest.json",
  "deployments/mainnet/manifest.json",
  "docs/INDEPENDENT_AUDIT_HANDOFF.md",
  "docs/ZK_MAINNET_CEREMONY_HANDOFF.md",
  "docs/PRIVACY_GUARANTEES.md",
  "docs/THREAT_MODEL.md",
  "scripts/check-shielded-mainnet.mjs",
  "scripts/prepare-zk-review-handoff.mjs",
  "scripts/verify-zk-review-handoff.mjs",
]);

async function collect(relative) {
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink excluded: ${name}`);
    if (entry.isDirectory()) await collect(name);
    else if (/\.(?:sol|circom|ts|tsx|js|mjs|json)$/u.test(entry.name))
      files.add(name);
  }
}
for (const directory of sources) await collect(directory);
for (const name of [
  "withdraw.wasm",
  "withdraw-v1-final.zkey",
  "withdraw-verification-key.json",
  "withdraw-manifest.json",
])
  files.add(`apps/web/public/zk/testnet/${name}`);

const entries = [];
for (const name of [...files].sort()) {
  if (
    /(?:^|\/)(?:\.env[^/]*|node_modules|private|secrets|keys)(?:\/|$)|\.private\./u.test(
      name,
    )
  )
    throw new Error(`Sensitive path excluded: ${name}`);
  if (!(await lstat(path.join(root, name))).isFile())
    throw new Error(`Not a regular file: ${name}`);
  const bytes = await readFile(path.join(root, name));
  entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
const snapshotSha256 = hash(JSON.stringify(entries));
const output = path.join(
  root,
  "docs/handoff",
  `zk-mainnet-${snapshotSha256.slice(0, 12)}`,
);
await mkdir(output, { recursive: true });
for (const entry of entries) {
  const destination = path.join(output, "source", entry.path);
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = await readFile(path.join(root, entry.path));
  if (hash(bytes) !== entry.sha256)
    throw new Error(`Source changed during export: ${entry.path}`);
  await writeFile(destination, bytes);
}
let baseCommit = null;
try {
  baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  /* Snapshot hashes remain authoritative without Git. */
}
await writeFile(
  path.join(output, "inventory.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      protocol: "ZKBLAST",
      purpose: "independent-review-not-launch-approval",
      snapshotSha256,
      baseCommit,
      identity:
        "Exact allowlisted file hashes; base commit alone does not identify dirty working-tree content",
      exclusions: [
        "credentials",
        "environment files",
        "private deployment journals",
        "notes",
        "witnesses",
        "ceremony entropy",
        "independent approval (not yet available)",
      ],
      setupStatus:
        "Only testnet proving artifacts included. Mainnet ceremony not performed.",
      entries,
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify(
    {
      output: path.relative(root, output),
      files: entries.length,
      snapshotSha256,
      warning:
        "Source/export allowlist only; manually review before sharing. Not an audit or mainnet ceremony.",
    },
    null,
    2,
  ),
);
