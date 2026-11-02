import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { groth16 } from "snarkjs";

const root = path.resolve(import.meta.dirname, "..");
const release = path.join(root, "target/launchpad-claim-v1-candidate");
const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
const proof = JSON.parse(await readFile(path.join(release, "valid-proof.json"), "utf8"));
const publicSignals = JSON.parse(await readFile(path.join(release, "valid-public.json"), "utf8"));
const verificationKey = JSON.parse(await readFile(path.join(release, "claim-authorization_verification_key.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (manifest.publicInputs !== 15 || manifest.privateInputs !== 2) throw new Error("manifest arity mismatch");
for (const asset of Object.values(manifest.assets)) {
  const bytes = await readFile(path.join(release, path.basename(asset.path)));
  if (sha256(bytes) !== asset.sha256) throw new Error(`hash mismatch: ${asset.path}`);
}
if (!(await groth16.verify(verificationKey, publicSignals, proof))) throw new Error("valid proof rejected");
const indexes = [2, 5, 6, 9, 10, 11, 12, 13, 14];
for (const index of indexes) {
  const mutated = [...publicSignals];
  mutated[index] = (BigInt(mutated[index]) + 1n).toString();
  if (await groth16.verify(verificationKey, mutated, proof)) {
    throw new Error(`mutated public input ${index} accepted`);
  }
}
process.stdout.write(`Launchpad claim release accepted 1 valid vector and rejected ${indexes.length} context mutations\n`);
