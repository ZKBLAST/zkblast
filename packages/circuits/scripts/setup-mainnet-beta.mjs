import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as snarkjs from "snarkjs";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "target/mainnet-beta-withdraw-v1");
const file = (name) => path.join(target, name);
const digest = async (name) =>
  createHash("sha256")
    .update(await readFile(name))
    .digest("hex");
const exists = (name) =>
  access(name).then(
    () => true,
    () => false,
  );
const stage = process.argv[2];
const artifacts = JSON.parse(
  await readFile(
    path.join(root, "architecture/withdraw-v1-artifacts.json"),
    "utf8",
  ),
);

async function freshOutput(name) {
  if (await exists(file(name)))
    throw new Error(`SETUP_OUTPUT_ALREADY_EXISTS: ${name}`);
}
async function assertBuild() {
  for (const [name, source] of Object.entries({
    withdraw: "withdraw",
    poseidon2Adapter: "poseidon2",
    constraints: "constraints",
  })) {
    if (
      (await digest(path.join(root, `src/v1/${source}.circom`))) !==
      artifacts.sourceSha256[name]
    )
      throw new Error(`CIRCUIT_SOURCE_HASH_MISMATCH: ${name}`);
  }
  for (const [name, expected] of [
    ["withdraw.r1cs", artifacts.reproducibleBuild.r1csSha256],
    ["withdraw.wasm", artifacts.reproducibleBuild.wasmSha256],
  ]) {
    if ((await digest(file(name))) !== expected)
      throw new Error(`COMPILED_ARTIFACT_HASH_MISMATCH: ${name}`);
  }
}
async function initialize() {
  await freshOutput("pot15_0000.ptau");
  await copyFile(
    path.join(root, "target/v1-withdraw/withdraw.r1cs"),
    file("withdraw.r1cs"),
  );
  await copyFile(
    path.join(root, "target/v1-withdraw/withdraw_js/withdraw.wasm"),
    file("withdraw.wasm"),
  );
  await assertBuild();
  const curve = await snarkjs.curves.getCurveFromName("bn128");
  await snarkjs.powersOfTau.newAccumulator(curve, 15, file("pot15_0000.ptau"));
  await curve.terminate();
}
async function phaseOne() {
  await freshOutput("pot15_phase1.ptau");
  await snarkjs.powersOfTau.contribute(
    file("pot15_0000.ptau"),
    file("pot15_phase1.ptau"),
    "ZKBLAST experimental mainnet single operator",
    randomBytes(64).toString("hex"),
  );
  if (!(await snarkjs.powersOfTau.verify(file("pot15_phase1.ptau"))))
    throw new Error("PHASE1_VERIFICATION_FAILED");
}
async function phaseTwo() {
  await freshOutput("pot15_phase2.ptau");
  await assertBuild();
  await snarkjs.powersOfTau.preparePhase2(
    file("pot15_phase1.ptau"),
    file("pot15_phase2.ptau"),
  );
  await freshOutput("withdraw_initial.zkey");
  await snarkjs.zKey.newZKey(
    file("withdraw.r1cs"),
    file("pot15_phase2.ptau"),
    file("withdraw_initial.zkey"),
  );
}
async function finalize() {
  await freshOutput("withdraw_final.zkey");
  await assertBuild();
  await snarkjs.zKey.contribute(
    file("withdraw_initial.zkey"),
    file("withdraw_final.zkey"),
    "ZKBLAST experimental mainnet single operator phase2",
    randomBytes(64).toString("hex"),
  );
  if (
    !(await snarkjs.zKey.verifyFromR1cs(
      file("withdraw.r1cs"),
      file("pot15_phase2.ptau"),
      file("withdraw_final.zkey"),
    ))
  )
    throw new Error("FINAL_KEY_VERIFICATION_FAILED");
  const verificationKey = await snarkjs.zKey.exportVerificationKey(
    file("withdraw_final.zkey"),
  );
  await writeFile(
    file("verification_key.json"),
    `${JSON.stringify(verificationKey, null, 2)}\n`,
    { flag: "wx" },
  );
  const generated = await snarkjs.zKey.exportSolidityVerifier(
    file("withdraw_final.zkey"),
    {
      groth16: await readFile(
        path.join(
          root,
          "node_modules/snarkjs/templates/verifier_groth16.sol.ejs",
        ),
        "utf8",
      ),
    },
  );
  await writeFile(file("WithdrawGroth16Verifier.sol"), generated, {
    flag: "wx",
  });

  // Local fixture only: never send its commitment or secrets to a deployed vault.
  const input = JSON.parse(
    await readFile(path.join(root, "vectors/v1/withdraw-valid.json"), "utf8"),
  );
  input.chain_id = "4663";
  const witnessPath = file("local-fixture.wtns");
  const {
    chain_id,
    vault_address,
    asset_address,
    amount,
    secret,
    nonce,
    path_siblings,
    path_directions,
  } = input;
  await snarkjs.wtns.calculate(
    {
      chain_id,
      vault_address,
      asset_address,
      amount,
      secret,
      nonce,
      path_siblings,
      path_directions,
    },
    path.join(
      root,
      "target/v1-vector/vector-generator_js/vector-generator.wasm",
    ),
    witnessPath,
  );
  const witness = await snarkjs.wtns.exportJson(witnessPath);
  input.merkle_root = String(witness[2]);
  input.nullifier = String(witness[3]);
  const result = await snarkjs.groth16.fullProve(
    input,
    file("withdraw.wasm"),
    file("withdraw_final.zkey"),
  );
  if (
    result.publicSignals.length !== 13 ||
    result.publicSignals[2] !== "4663" ||
    !(await snarkjs.groth16.verify(
      verificationKey,
      result.publicSignals,
      result.proof,
    ))
  )
    throw new Error("LOCAL_MAINNET_CONTEXT_PROOF_FAILED");
  if (
    (await digest(file("withdraw_final.zkey"))) ===
    artifacts.ceremony.provingKeySha256
  )
    throw new Error("TESTNET_KEY_REUSE_REJECTED");
  const hashes = {};
  for (const name of [
    "withdraw.r1cs",
    "withdraw.wasm",
    "pot15_phase1.ptau",
    "pot15_phase2.ptau",
    "withdraw_final.zkey",
    "verification_key.json",
    "WithdrawGroth16Verifier.sol",
  ])
    hashes[name] = await digest(file(name));
  await writeFile(
    file("setup-report.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        protocol: "ZKBLAST",
        environment: "mainnet",
        chainId: 4663,
        circuitVersion: 1,
        trustModel: "experimental-single-operator",
        independentReview: false,
        notice:
          "Single operator local setup, not an independent ceremony/audit. Entropy destruction is not provable. No production custody approval.",
        verification: {
          keyVerified: true,
          localMainnetContextProof: true,
          publicInputs: 13,
          onchainAcceptance: false,
        },
        artifacts: hashes,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
}

async function main() {
  if (
    process.env.CONFIRM_EXPERIMENTAL_MAINNET_SETUP !==
    "SINGLE_OPERATOR_NO_INDEPENDENT_REVIEW"
  )
    throw new Error(
      "Explicit experimental local setup acknowledgement required",
    );
  await mkdir(target, { recursive: true, mode: 0o700 });
  const stages = {
    initialize,
    "phase-one": phaseOne,
    "phase-two": phaseTwo,
    finalize,
  };
  if (!stages[stage])
    throw new Error(
      "Usage: setup-mainnet-beta.mjs <initialize|phase-one|phase-two|finalize>",
    );
  await stages[stage]();
  console.log(
    JSON.stringify({
      stage,
      completed: true,
      trustModel: "experimental-single-operator",
      broadcasts: 0,
    }),
  );
}
main().then(
  () => process.exit(0),
  () => {
    console.error(
      `EXPERIMENTAL_SETUP_STAGE_FAILED: ${stage ?? "missing-stage"}; inspect local artifacts without publishing entropy`,
    );
    process.exit(1);
  },
);
