import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read valid JSON: ${relative}`);
  }
};
const checks = [];
const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
const deployment = await readJson("deployments/mainnet/manifest.json");
const artifacts = await readJson(
  "packages/circuits/architecture/withdraw-v1-artifacts.json",
);
const ceremony = await readJson(
  "packages/circuits/target/v1-withdraw/ceremony-transcript.mainnet.json",
);
const release = deployment?.shielded?.proverRelease;

check(
  "mainnet-network",
  deployment?.environment === "mainnet" && deployment.chainId === 4663,
);
check(
  "mainnet-key-deployable",
  artifacts?.ceremony?.mainnetKeyDeployable === true,
);
check("mainnet-ceremony-transcript", ceremony?.environment === "mainnet");
check("shielded-contracts-configured", deployment?.shielded);
check(
  "network-isolated-prover-path",
  /^\/zk\/mainnet\/[a-zA-Z0-9._-]+\.json$/u.test(release?.manifestPath ?? ""),
);
check(
  "pinned-prover-manifest",
  /^[a-f0-9]{64}$/u.test(release?.manifestSha256 ?? ""),
);

if (checks.at(-2).passed && checks.at(-1).passed) {
  const publicPath = path.join(root, "apps/web/public", release.manifestPath);
  let matches = false;
  try {
    const bytes = await readFile(publicPath);
    matches =
      createHash("sha256").update(bytes).digest("hex") ===
      release.manifestSha256;
  } catch {
    // Missing public artifacts must never be treated as a ready release.
  }
  check("published-prover-manifest-hash", matches);
}

const passed = checks.filter((item) => item.passed).length;
console.log(
  JSON.stringify(
    {
      scope: "shielded-mainnet-preflight",
      mode: "read-only-no-broadcast",
      passed,
      total: checks.length,
      checks,
      readyForCustody: false,
      notice:
        "Technical preflight only. Ceremony review, contract/circuit review, recovery acceptance and explicit launch approval remain separate gates.",
    },
    null,
    2,
  ),
);
if (passed !== checks.length) process.exitCode = 1;
