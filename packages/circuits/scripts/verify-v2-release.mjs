import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import * as snarkjs from "snarkjs";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "target/v2-testnet");
const stageName = process.argv[2];
if (!/^browser-stage-[A-Za-z0-9_-]+$/u.test(stageName ?? ""))
  throw new Error("Explicit v2 stage required");
const stage = path.join(target, stageName);
const { run } = JSON.parse(
  await readFile(path.join(target, "last-run.json"), "utf8"),
);
assert.match(run, /^run-[A-Za-z0-9_-]+$/u);
const original = path.join(target, run);
const fresh = await mkdtemp(path.join(target, "verified-build-"));
const build = JSON.parse(
  await readFile(path.join(original, "build.json"), "utf8"),
);
const release = JSON.parse(
  await readFile(path.join(original, "release.local.json"), "utf8"),
);
const evidence = JSON.parse(
  await readFile(path.join(original, "real-proof-results.local.json"), "utf8"),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = async (filename) => sha(await readFile(filename));
const execute = promisify(execFile);
const quiet = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
const results = [];
let curve;
try {
  for (const name of ["action", "fund", "spend-vector"]) {
    await execute(
      path.join(root, "node_modules/.bin/circom2"),
      [
        path.join(root, `src/v2/${name}.circom`),
        "--O2",
        "--r1cs",
        "--wasm",
        "--sym",
        "-o",
        fresh,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    assert.equal(
      await fileHash(path.join(fresh, `${name}.r1cs`)),
      build.circuits[name].r1csSha256,
      `${name}: source/R1CS mismatch`,
    );
    assert.equal(
      await fileHash(path.join(fresh, `${name}_js/${name}.wasm`)),
      build.circuits[name].wasmSha256,
      `${name}: source/WASM mismatch`,
    );
    console.log(`${name}: current source reproduces pinned R1CS and WASM`);
  }
  const prepared = path.join(original, "pot16-v2-phase2.ptau");
  assert.equal(await fileHash(prepared), evidence.publicPreparedPhase2Sha256);
  const template = await readFile(
    path.join(root, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"),
    "utf8",
  );
  for (const name of ["action", "fund"]) {
    const key = path.join(original, `${name}-testnet.zkey`);
    const info = release.artifacts[name];
    assert.equal(await fileHash(key), info.provingKeySha256);
    assert.ok(
      await snarkjs.zKey.verifyFromR1cs(
        path.join(fresh, `${name}.r1cs`),
        prepared,
        key,
        quiet,
      ),
      `${name}: key/R1CS verification failed`,
    );
    const vkey = await snarkjs.zKey.exportVerificationKey(key);
    assert.deepEqual(
      vkey,
      JSON.parse(
        await readFile(path.join(original, `${name}-vkey.json`), "utf8"),
      ),
    );
    const source = await snarkjs.zKey.exportSolidityVerifier(key, {
      groth16: template,
    });
    assert.equal(sha(source), info.solidityVerifierSha256);
    const prefix = name === "action" ? "Action" : "Fund";
    const copiedSource = await readFile(
      path.resolve(
        root,
        `../contracts/test/generated-v2-local/${prefix}Groth16.local.sol`,
      ),
    );
    assert.equal(sha(copiedSource), sha(source));
    const artifact = JSON.parse(
      await readFile(
        path.resolve(
          root,
          `../contracts/out/${prefix}Groth16.local.sol/Groth16Verifier.json`,
        ),
        "utf8",
      ),
    );
    // Solidity source hash is checked by the deployment rehearsal against compiler metadata.
    assert.equal(artifact.metadata.compiler.version, "0.8.26+commit.8a97fa7a");
    for (const [suffix, expected] of [
      [`${name}.wasm`, info.wasmSha256],
      [`${name}.zkey`, info.provingKeySha256],
      [`${name}-vkey.json`, info.verificationKeySha256],
    ])
      assert.equal(
        await fileHash(path.join(stage, "public/zk/testnet/v2", suffix)),
        expected,
      );
    results.push({
      circuit: name,
      publicInputs: vkey.nPublic,
      sourceR1csWasmReproduced: true,
      zkeyVerifiedAgainstR1cs: true,
      verificationKeyReexportMatches: true,
      solidityReexportMatches: true,
    });
    console.log(
      `${name}: existing key, verification key and Solidity verifier verified; no setup regenerated`,
    );
  }
  assert.equal(
    await fileHash(path.join(stage, "public/zk/testnet/v2/note.wasm")),
    build.circuits["spend-vector"].wasmSha256,
  );
  await writeFile(
    path.join(stage, "artifact-verification.json"),
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        environment: "testnet",
        sourceRun: run,
        freshBuild: path.basename(fresh),
        results,
        setupRegenerated: false,
        activationAllowed: false,
        independentReview: false,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  curve = await snarkjs.curves.getCurveFromName("bn128");
  await curve.terminate();
}
