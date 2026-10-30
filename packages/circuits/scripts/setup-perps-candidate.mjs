import { execFile } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const kinds = ["open", "close", "modify", "claim-liquidated"];
const sourceNames = {
  open: "open.circom",
  close: "close.circom",
  modify: "modify.circom",
  "claim-liquidated": "claim-liquidated.circom",
};
const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const ptau = argument("ptau");
const outputRoot = argument("output-root");
if (!ptau || !outputRoot) {
  throw new Error("Usage: --ptau <phase-2 ptau> --output-root <ignored candidate directory>");
}

const circom = path.join(root, "node_modules/.bin/circom2");
const snarkjs = path.join(root, "node_modules/.bin/snarkjs");
const temporary = await mkdtemp(path.join(tmpdir(), "zkblast-perps-setup-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = { schemaVersion: 1, proofSystem: "groth16", curve: "bn128", circuits: {} };

try {
  for (const kind of kinds) {
    const build = path.join(temporary, kind);
    const destination = path.resolve(outputRoot, kind);
    await mkdir(build, { recursive: true });
    await mkdir(destination, { recursive: true });
    const source = path.join(root, "src/perps", sourceNames[kind]);
    await run(circom, [source, "--r1cs", "--wasm", "--sym", "-o", build]);
    const r1cs = path.join(build, `${kind}.r1cs`);
    const initialZkey = path.join(build, `${kind}_initial.zkey`);
    const finalZkey = path.join(destination, `${kind}_final.zkey`);
    await run(snarkjs, ["groth16", "setup", r1cs, path.resolve(ptau), initialZkey]);
    const entropy = randomBytes(64).toString("hex");
    await run(snarkjs, [
      "zkey", "contribute", initialZkey, finalZkey,
      "--name=ZKBLAST Perps isolated candidate", `-e=${entropy}`,
    ]);
    await run(snarkjs, ["zkey", "verify", r1cs, path.resolve(ptau), finalZkey]);
    const wasmSource = path.join(build, `${kind}_js`, `${kind}.wasm`);
    const wasmDestination = path.join(destination, `${kind}.wasm`);
    const r1csDestination = path.join(destination, `${kind}.r1cs`);
    await copyFile(wasmSource, wasmDestination);
    await copyFile(r1cs, r1csDestination);
    const [sourceBytes, wasmBytes, r1csBytes, zkeyBytes] = await Promise.all([
      readFile(source), readFile(wasmDestination), readFile(r1csDestination), readFile(finalZkey),
    ]);
    report.circuits[kind] = {
      sourceSha256: sha256(sourceBytes),
      wasmSha256: sha256(wasmBytes),
      r1csSha256: sha256(r1csBytes),
      zkeySha256: sha256(zkeyBytes),
    };
  }
  const positionBuild = path.join(temporary, "position-vector");
  const positionDestination = path.resolve(outputRoot, "position-vector");
  await mkdir(positionBuild, { recursive: true });
  await mkdir(positionDestination, { recursive: true });
  const positionSource = path.join(root, "src/perps/position-vector.circom");
  await run(circom, [positionSource, "--wasm", "-o", positionBuild]);
  const positionWasmSource = path.join(positionBuild, "position-vector_js", "position-vector.wasm");
  const positionWasmDestination = path.join(positionDestination, "position-vector.wasm");
  await copyFile(positionWasmSource, positionWasmDestination);
  await copyFile(
    path.join(positionBuild, "position-vector_js", "witness_calculator.js"),
    path.join(positionDestination, "witness_calculator.js"),
  );
  report.positionCalculator = {
    sourceSha256: sha256(await readFile(positionSource)),
    wasmSha256: sha256(await readFile(positionWasmDestination)),
  };
  const ptauBytes = await readFile(path.resolve(ptau));
  report.ptauSha256 = sha256(ptauBytes);
  await mkdir(path.resolve(outputRoot), { recursive: true });
  await writeFile(
    path.resolve(outputRoot, "setup-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`Prepared ${kinds.length} isolated Perps setup candidates and position calculator\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
