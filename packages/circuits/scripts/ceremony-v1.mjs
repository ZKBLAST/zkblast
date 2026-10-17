import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as snarkjs from "snarkjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const target = path.join(packageRoot, "target/v1-withdraw");
const r1cs = path.join(target, "withdraw.r1cs");
const wasm = path.join(target, "withdraw_js/withdraw.wasm");
const witness = path.join(target, "valid.wtns");
const ptauRaw = path.join(target, "pot15_0000.ptau");
const ptauContributed = path.join(target, "pot15_phase1.ptau");
const ptauPrepared = path.join(target, "pot15_phase2.ptau");
const zkeyInitial = path.join(target, "withdraw_v1_0000.zkey");
const zkeyContribution1 = path.join(target, "withdraw_v1_0001.zkey");
const zkeyContribution2 = path.join(target, "withdraw_v1_0002.zkey");
const zkeyFinal = path.join(target, "withdraw_v1_final.zkey");
const verificationKey = path.join(target, "verification_key.json");
const proofFile = path.join(target, "proof.json");
const publicFile = path.join(target, "public.json");
const transcriptFile = path.join(target, "ceremony-transcript.testnet.json");
const validInput = path.join(target, "valid.json");
const stage = process.argv[2];

await mkdir(target, { recursive: true });

const logger = {
  debug() {},
  log(message) {
    process.stdout.write(`${message}\n`);
  },
  info(message) {
    process.stdout.write(`${message}\n`);
  },
  warn(message) {
    process.stderr.write(`${message}\n`);
  },
  error(message) {
    process.stderr.write(`${message}\n`);
  },
};

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const sha256 = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");
const exists = async (file) => access(file).then(() => true, () => false);
const requireFile = async (file) => {
  if (!(await exists(file))) throw new Error(`Required artifact is missing: ${path.basename(file)}`);
};

async function bootstrap() {
  await requireFile(r1cs);
  const curve = await snarkjs.curves.getCurveFromName("bn128");
  await snarkjs.powersOfTau.newAccumulator(curve, 15, ptauRaw, logger);
  await curve.terminate();
  const phase1Entropy = randomBytes(64).toString("hex");
  await snarkjs.powersOfTau.contribute(
    ptauRaw,
    ptauContributed,
    "ZKBLAST testnet phase-1 bootstrap",
    phase1Entropy,
    logger,
  );
  await snarkjs.powersOfTau.preparePhase2(ptauContributed, ptauPrepared, logger);
  await snarkjs.zKey.newZKey(r1cs, ptauPrepared, zkeyInitial, logger);
  process.stdout.write("Bootstrap and circuit-specific phase-2 initialization complete.\n");
}

async function contribute(input, output, contributor) {
  await requireFile(input);
  const entropy = randomBytes(64).toString("hex");
  const contributionHash = await snarkjs.zKey.contribute(
    input,
    output,
    contributor,
    entropy,
    logger,
  );
  process.stdout.write(`Recorded ${contributor}: ${hex(contributionHash)}\n`);
}

async function finalize() {
  await requireFile(zkeyContribution2);
  const beacon = createHash("sha256")
    .update(`ZKBLAST-testnet-withdraw-v1:${new Date().toISOString()}:${randomBytes(32).toString("hex")}`)
    .digest("hex");
  const beaconContributionHash = await snarkjs.zKey.beacon(
    zkeyContribution2,
    zkeyFinal,
    "ZKBLAST testnet final beacon",
    beacon,
    10,
    logger,
  );
  const verified = await snarkjs.zKey.verifyFromR1cs(r1cs, ptauPrepared, zkeyFinal, logger);
  if (!verified) throw new Error("Final zkey verification failed");

  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinal);
  await writeFile(verificationKey, `${JSON.stringify(vkey, null, 2)}\n`);
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyFinal, witness);
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
    throw new Error("Generated proof failed local verification");
  }
  await writeFile(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
  await writeFile(publicFile, `${JSON.stringify(publicSignals, null, 2)}\n`);

  const transcript = {
    protocol: "ZKBLAST",
    environment: "testnet",
    circuitId: "withdraw",
    circuitVersion: 1,
    trustNotice: "Development/testnet-only ceremony. Both entropy contributions were produced by separate processes on one device and are not independent-party trust for mainnet.",
    entropyHandling: "Each contribution used 64 cryptographically random bytes generated only in process memory; raw entropy was neither logged nor persisted.",
    phase1Power: 15,
    beacon: {
      value: beacon,
      iterationsExponent: 10,
      contributionHash: hex(beaconContributionHash),
    },
    verification: {
      zkeyVerifiedAgainstR1csAndPtau: true,
      validVectorProofVerified: true,
    },
    artifacts: {
      r1csSha256: await sha256(r1cs),
      wasmSha256: await sha256(wasm),
      provingKeySha256: await sha256(zkeyFinal),
      verificationKeySha256: await sha256(verificationKey),
      proofSha256: await sha256(proofFile),
      publicSignalsSha256: await sha256(publicFile),
      validInputSha256: await sha256(validInput),
    },
    completedAt: new Date().toISOString(),
  };
  await writeFile(transcriptFile, `${JSON.stringify(transcript, null, 2)}\n`);
  process.stdout.write(`Final testnet proving key: ${transcript.artifacts.provingKeySha256}\n`);
  process.stdout.write("Final proof verified locally.\n");
}

switch (stage) {
  case "bootstrap":
    await bootstrap();
    break;
  case "contribute-1":
    await contribute(zkeyInitial, zkeyContribution1, "ZKBLAST testnet contributor process 1");
    break;
  case "contribute-2":
    await contribute(zkeyContribution1, zkeyContribution2, "ZKBLAST testnet contributor process 2");
    break;
  case "finalize":
    await finalize();
    break;
  default:
    throw new Error("Usage: pnpm v1:ceremony <bootstrap|contribute-1|contribute-2|finalize>");
}
