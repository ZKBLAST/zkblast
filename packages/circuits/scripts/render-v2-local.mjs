import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { writeLocalProofTest } from "../test/helpers/v2-evm-template.mjs";

const target = path.resolve(import.meta.dirname, "../target/v2-testnet");
const run = JSON.parse(
  await readFile(path.join(target, "last-run.json"), "utf8"),
).run;
if (!/^run-[A-Za-z0-9_-]+$/u.test(run)) throw new Error("Invalid local run");
const directory = path.join(target, run);
const release = JSON.parse(
  await readFile(path.join(directory, "release.local.json"), "utf8"),
);
const report = JSON.parse(
  await readFile(path.join(directory, "real-proof-results.local.json"), "utf8"),
);
if (!report.syntheticOnly || release.environment !== "testnet")
  throw new Error("Not local fixtures");
const results = Object.fromEntries(
  await Promise.all(
    report.cases.map(async (name) => {
      if (!/^[A-Za-z0-9]+$/u.test(name))
        throw new Error("Invalid fixture name");
      return [
        name,
        JSON.parse(
          await readFile(
            path.join(directory, "local-proofs", `${name}.json`),
            "utf8",
          ),
        ),
      ];
    }),
  ),
);
await writeLocalProofTest(run, directory, release, results);
report.publicPreparedPhase2Sha256 = createHash("sha256")
  .update(await readFile(path.join(directory, "pot16-v2-phase2.ptau")))
  .digest("hex");
await writeFile(
  path.join(directory, "real-proof-results.local.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(
  "Local proof tests re-rendered from existing public proofs; no keys or proofs regenerated.\n",
);
