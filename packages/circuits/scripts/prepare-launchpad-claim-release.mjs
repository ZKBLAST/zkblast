import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const projectRoot = path.resolve(root, "../..");
const temporary = await mkdtemp(path.join(tmpdir(), "zkblast-launchpad-claim-"));
const output = path.join(root, "target/launchpad-claim-v1-candidate");
const webOutput = path.join(projectRoot, "apps/web/public/zk/launchpad-claim-v1");
const circom = path.join(root, "node_modules/.bin/circom2");
const snarkjs = path.join(root, "node_modules/.bin/snarkjs");
const ptau = path.join(root, "target/perps-pot16-phase2.ptau");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const base = {
  schema_version: "1", action: "1", chain_id: "46630",
  adapter: "1000000000000000000000000000000000000001", verifier_version: "1",
  launchpad_id: "7", pool: "1000000000000000000000000000000000000002",
  snapshot_low: "123456789", snapshot_high: "987654321",
  recipient: "1000000000000000000000000000000000000003",
  asset: "1000000000000000000000000000000000000004",
  max_amount: "5000000", deadline: "2000000000", secret: "12345678901234567890",
  nonce: "998877665544332211",
};

try {
  await mkdir(output, { recursive: true });
  await mkdir(webOutput, { recursive: true });
  const vectorSource = path.join(root, "src/launchpad/claim-authorization-vector.circom");
  const circuitSource = path.join(root, "src/launchpad/claim-authorization.circom");
  await run(circom, [vectorSource, "--wasm", "--sym", "-o", temporary]);
  await writeFile(path.join(temporary, "vector-input.json"), JSON.stringify(base));
  await run(snarkjs, ["wtns", "calculate", path.join(temporary, "claim-authorization-vector_js/claim-authorization-vector.wasm"), path.join(temporary, "vector-input.json"), path.join(temporary, "vector.wtns")]);
  await run(snarkjs, ["wtns", "export", "json", path.join(temporary, "vector.wtns"), path.join(temporary, "vector-witness.json")]);
  const witness = JSON.parse(await readFile(path.join(temporary, "vector-witness.json"), "utf8"));
  const input = { ...base, nullifier: witness[1], authorization_commitment: witness[2] };

  await run(circom, [circuitSource, "--r1cs", "--wasm", "--sym", "-o", temporary]);
  const r1cs = path.join(temporary, "claim-authorization.r1cs");
  const initial = path.join(temporary, "claim-authorization-initial.zkey");
  const zkey = path.join(output, "claim-authorization_final.zkey");
  await run(snarkjs, ["groth16", "setup", r1cs, ptau, initial]);
  await run(snarkjs, ["zkey", "contribute", initial, zkey, "--name=ZKBLAST launchpad claim candidate", `-e=${randomBytes(64).toString("hex")}`]);
  await run(snarkjs, ["zkey", "verify", r1cs, ptau, zkey]);
  const wasm = path.join(output, "claim-authorization.wasm");
  const vkey = path.join(output, "claim-authorization_verification_key.json");
  const verifier = path.join(output, "LaunchpadClaimGroth16Verifier.sol");
  await copyFile(path.join(temporary, "claim-authorization_js/claim-authorization.wasm"), wasm);
  await run(snarkjs, ["zkey", "export", "verificationkey", zkey, vkey]);
  await run(snarkjs, ["zkey", "export", "solidityverifier", zkey, verifier]);
  const verifierText = await readFile(verifier, "utf8");
  await writeFile(verifier, verifierText.replace("contract Groth16Verifier", "contract LaunchpadClaimGroth16Verifier"));
  await writeFile(path.join(output, "valid-input.json"), `${JSON.stringify(input, null, 2)}\n`);
  await run(snarkjs, ["groth16", "fullprove", path.join(output, "valid-input.json"), wasm, zkey, path.join(output, "valid-proof.json"), path.join(output, "valid-public.json")]);
  await run(snarkjs, ["groth16", "verify", vkey, path.join(output, "valid-public.json"), path.join(output, "valid-proof.json")]);
  const negatives = ["chain_id", "launchpad_id", "pool", "recipient", "asset", "max_amount", "deadline", "nullifier", "authorization_commitment"];
  await writeFile(path.join(output, "negative-mutations.json"), `${JSON.stringify({ mutateOneAtATime: negatives }, null, 2)}\n`);

  const files = {
    wasm: { path: "/zk/launchpad-claim-v1/claim-authorization.wasm", file: wasm },
    zkey: { path: "/zk/launchpad-claim-v1/claim-authorization_final.zkey", file: zkey },
    verificationKey: { path: "/zk/launchpad-claim-v1/claim-authorization_verification_key.json", file: vkey },
  };
  for (const item of Object.values(files)) await copyFile(item.file, path.join(webOutput, path.basename(item.file)));
  const manifest = {
    schemaVersion: 1, feature: "launchpad-proof-claim", circuitVersion: 1,
    proofSystem: "groth16", curve: "bn128", publicInputs: 15, privateInputs: 2,
    sourceSha256: sha256(await readFile(circuitSource)),
    verifierSha256: sha256(await readFile(verifier)),
    assets: Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, item]) => [key, { path: item.path, sha256: sha256(await readFile(item.file)) }]))),
    vector: {
      inputSha256: sha256(await readFile(path.join(output, "valid-input.json"))),
      proofSha256: sha256(await readFile(path.join(output, "valid-proof.json"))),
      publicSha256: sha256(await readFile(path.join(output, "valid-public.json"))),
      negativeMutations: negatives,
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(output, "manifest.json"), manifestBytes);
  await writeFile(path.join(webOutput, "manifest.json"), manifestBytes);
  process.stdout.write(`Prepared launchpad claim candidate ${sha256(manifestBytes)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
