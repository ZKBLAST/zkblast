import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  copyFile,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import * as snarkjs from "snarkjs";

// Local candidate only: no environment credentials, RPC, signatures or publication.
const root = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = async (file) => hash(await readFile(file));
const json = async (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n");
const sourceStage = path.join(root, "target/v2-testnet/browser-stage-vUqQ3m");
const evidence = JSON.parse(
  await readFile(path.join(sourceStage, "artifact-verification.json"), "utf8"),
);
if (
  evidence.results.length !== 2 ||
  !evidence.results.every((result) => result.zkeyVerifiedAgainstR1cs)
)
  throw new Error("VERIFIED_CIRCUIT_BUILD_REQUIRED");
const source = path.join(root, "target/v2-testnet/run-4joRG7");
const prior = JSON.parse(
  await readFile(path.join(source, "release.local.json"), "utf8"),
);
const priorProofReport = JSON.parse(
  await readFile(path.join(source, "real-proof-results.local.json"), "utf8"),
);
const publicTranscript = path.join(source, "pot16-v2-phase2.ptau");
if (
  (await sha(publicTranscript)) !== priorProofReport.publicPreparedPhase2Sha256
)
  throw new Error("PUBLIC_TRANSCRIPT_HASH_MISMATCH");
await mkdir(path.join(root, "target/v2-mainnet"), { recursive: true });
const directory = await mkdtemp(
  path.join(root, "target/v2-mainnet/candidate-"),
);
await mkdir(path.join(directory, "verifiers"));
const quiet = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
const artifacts = {};
let curve;
try {
  curve = await snarkjs.curves.getCurveFromName("bn128");
  for (const kind of ["action", "fund"]) {
    const r1cs = path.join(source, `${kind}.r1cs`);
    const wasm = path.join(source, `${kind}_js/${kind}.wasm`);
    if (
      (await sha(r1cs)) !== prior.artifacts[kind].r1csSha256 ||
      (await sha(wasm)) !== prior.artifacts[kind].wasmSha256
    )
      throw new Error("CIRCUIT_BUILD_CHANGED");
    await copyFile(wasm, path.join(directory, `${kind}.wasm`));
    const initial = path.join(directory, `${kind}-initial.private.zkey`);
    const final = path.join(directory, `${kind}-mainnet-candidate.zkey`);
    console.log(
      `${kind}: generating fresh mainnet-candidate key (no testnet key reuse)`,
    );
    await snarkjs.zKey.newZKey(r1cs, publicTranscript, initial, quiet);
    await snarkjs.zKey.contribute(
      initial,
      final,
      "ZKBLAST isolated mainnet v2 candidate operator",
      randomBytes(64).toString("hex"),
      quiet,
    );
    if (
      !(await snarkjs.zKey.verifyFromR1cs(r1cs, publicTranscript, final, quiet))
    )
      throw new Error("FRESH_KEY_VERIFICATION_FAILED");
    const vkey = await snarkjs.zKey.exportVerificationKey(final);
    await json(path.join(directory, `${kind}-vkey.json`), vkey);
    const templates = {
      groth16: await readFile(
        path.join(
          root,
          "node_modules/snarkjs/templates/verifier_groth16.sol.ejs",
        ),
        "utf8",
      ),
    };
    const solidity = await snarkjs.zKey.exportSolidityVerifier(
      final,
      templates,
    );
    const filename = `${kind === "action" ? "Action" : "Fund"}Groth16MainnetV2.sol`;
    await writeFile(path.join(directory, "verifiers", filename), solidity);
    artifacts[kind] = {
      publicInputs: vkey.nPublic,
      r1csSha256: await sha(r1cs),
      wasmSha256: await sha(wasm),
      provingKeySha256: await sha(final),
      verificationKeySha256: await sha(
        path.join(directory, `${kind}-vkey.json`),
      ),
      solidityVerifierSha256: hash(Buffer.from(solidity)),
      testnetKeyReused:
        (await sha(final)) === prior.artifacts[kind].provingKeySha256,
    };
    if (artifacts[kind].testnetKeyReused)
      throw new Error("TESTNET_KEY_REUSE_REJECTED");
    console.log(`${kind}: fresh key verified; ${vkey.nPublic} public inputs`);
  }
  await promisify(execFile)(
    path.join(homedir(), ".foundry/bin/forge"),
    [
      "build",
      "--root",
      directory,
      "--contracts",
      "verifiers",
      "--out",
      "out",
      "--cache-path",
      "cache",
      "--use",
      "0.8.26",
      "--optimize",
      "--optimizer-runs",
      "200",
      "--no-metadata",
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  await json(path.join(directory, "candidate.json"), {
    environment: "mainnet",
    chainId: 4663,
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    trustModel: "single-operator-mainnet-candidate",
    independentReview: false,
    eligibleForDeployment: false,
    activationAllowed: false,
    broadcastAllowed: false,
    publicPreparedPhase2Sha256: await sha(publicTranscript),
    artifacts,
    sourceBuild:
      "verified unchanged v2 R1CS/WASM only; no source testnet proving key copied",
  });
  await json(path.join(root, "target/v2-mainnet/last-candidate.json"), {
    candidate: path.basename(directory),
  });
  console.log(
    `CANDIDATE_READY ${path.basename(directory)}; no active manifest or public assets changed`,
  );
} finally {
  await curve?.terminate();
}
