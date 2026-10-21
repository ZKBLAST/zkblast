import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import * as snarkjs from "snarkjs";

// Local testnet artifacts only. No env, wallet, RPC, API or deployment access.
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "target/v2-testnet");
const stage = process.argv[2] ?? "build";
const sha = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const json = async (file, value) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const quiet = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
let curve;

try {
  await mkdir(target, { recursive: true });
  if (stage === "build") {
    const directory = await mkdtemp(path.join(target, "run-"));
    const circuits = {};
    for (const name of ["action", "fund", "spend-vector", "merkle-test"]) {
      const { stdout } = await run(
        path.join(root, "node_modules/.bin/circom2"),
        [
          path.join(root, `src/v2/${name}.circom`),
          "--O2",
          "--r1cs",
          "--wasm",
          "--sym",
          "-o",
          directory,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(`${name}: ${stdout.trim()}\n`);
      circuits[name] = {
        r1csSha256: await sha(path.join(directory, `${name}.r1cs`)),
        wasmSha256: await sha(path.join(directory, `${name}_js/${name}.wasm`)),
      };
    }
    const build = { environment: "testnet", schemaVersion: 2, circuits };
    await json(path.join(directory, "build.json"), build);
    await json(path.join(target, "last-run.json"), {
      run: path.basename(directory),
    });
    process.stdout.write(`v2 build complete: ${path.basename(directory)}\n`);
  } else if (stage === "setup") {
    const name =
      process.argv[3] ??
      JSON.parse(await readFile(path.join(target, "last-run.json"), "utf8"))
        .run;
    if (!/^run-[A-Za-z0-9_-]+$/u.test(name))
      throw new Error("Invalid local run identifier");
    const directory = path.join(target, name);
    const build = JSON.parse(
      await readFile(path.join(directory, "build.json"), "utf8"),
    );
    await writeFile(
      path.join(directory, "setup-started.lock"),
      "single-use local setup run\n",
      { flag: "wx" },
    );
    const phase1 = path.join(root, "target/v1-withdraw/pot16_final.ptau");
    // Reuse only the existing PUBLIC universal phase-1 transcript read-only.
    // Circuit-specific v1 proving/verification keys are never opened or reused.
    curve = await snarkjs.curves.getCurveFromName("bn128");
    process.stdout.write("Checking public phase-1 transcript (read-only)…\n");
    if (!(await snarkjs.powersOfTau.verify(phase1, quiet)))
      throw new Error("Public phase-1 transcript failed verification");
    const prepared = path.join(directory, "pot16-v2-phase2.ptau");
    const reusableRun = process.argv[4];
    if (reusableRun) {
      if (!/^run-[A-Za-z0-9_-]+$/u.test(reusableRun) || reusableRun === name)
        throw new Error("Invalid reusable public transcript run");
      const previous = path.join(target, reusableRun);
      const previousRelease = JSON.parse(
        await readFile(path.join(previous, "release.local.json"), "utf8"),
      );
      const report = JSON.parse(
        await readFile(
          path.join(previous, "real-proof-results.local.json"),
          "utf8",
        ),
      );
      const source = path.join(previous, "pot16-v2-phase2.ptau");
      if (
        previousRelease.environment !== "testnet" ||
        previousRelease.publicPhase1Sha256 !== (await sha(phase1)) ||
        report.publicPreparedPhase2Sha256 !== (await sha(source))
      )
        throw new Error("Reusable universal transcript hash mismatch");
      await copyFile(source, prepared, constants.COPYFILE_EXCL);
      process.stdout.write(
        "Reused hash-pinned PUBLIC universal transcript; circuit keys will still be fresh.\n",
      );
    } else {
      process.stdout.write("Preparing isolated v2 phase-2 transcript…\n");
      await snarkjs.powersOfTau.preparePhase2(phase1, prepared, quiet);
    }
    const artifacts = {};
    for (const circuit of ["action", "fund"]) {
      const r1cs = path.join(directory, `${circuit}.r1cs`);
      if ((await sha(r1cs)) !== build.circuits[circuit].r1csSha256)
        throw new Error("Build hash changed");
      const initial = path.join(directory, `${circuit}-initial.zkey`);
      const final = path.join(directory, `${circuit}-testnet.zkey`);
      process.stdout.write(`Creating fresh ${circuit} v2 proving key…\n`);
      await snarkjs.zKey.newZKey(r1cs, prepared, initial, quiet);
      await snarkjs.zKey.contribute(
        initial,
        final,
        "ZKBLAST v2 local testnet operator",
        randomBytes(64).toString("hex"),
        quiet,
      );
      if (!(await snarkjs.zKey.verifyFromR1cs(r1cs, prepared, final, quiet)))
        throw new Error(`${circuit} zkey verification failed`);
      const vkey = await snarkjs.zKey.exportVerificationKey(final);
      await json(path.join(directory, `${circuit}-vkey.json`), vkey);
      const templates = {
        groth16: await readFile(
          path.join(
            root,
            "node_modules/snarkjs/templates/verifier_groth16.sol.ejs",
          ),
          "utf8",
        ),
      };
      const source = await snarkjs.zKey.exportSolidityVerifier(
        final,
        templates,
      );
      await writeFile(path.join(directory, `${circuit}-verifier.sol`), source);
      artifacts[circuit] = {
        ...build.circuits[circuit],
        publicInputs: vkey.nPublic,
        provingKeySha256: await sha(final),
        verificationKeySha256: await sha(
          path.join(directory, `${circuit}-vkey.json`),
        ),
        solidityVerifierSha256: await sha(
          path.join(directory, `${circuit}-verifier.sol`),
        ),
      };
      process.stdout.write(
        `${circuit}: fresh key verified; ${vkey.nPublic} public inputs\n`,
      );
    }
    await json(path.join(directory, "release.local.json"), {
      environment: "testnet",
      schemaVersion: 2,
      trustModel: "single-operator-local-test",
      eligibleForDeployment: false,
      independentReview: false,
      publicPhase1Sha256: await sha(phase1),
      publicPreparedPhase2Sha256: await sha(prepared),
      artifacts,
    });
    process.stdout.write(
      `v2 setup complete: ${name}; deployment remains disabled\n`,
    );
  } else {
    throw new Error("Supported stages: build, setup");
  }
} finally {
  await curve?.terminate();
}
