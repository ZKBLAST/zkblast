import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const releaseRoot = path.join(root, "packages/circuits/target/perps-v1-release-mainnet");
const destination = path.join(root, "packages/contracts/src/perps/generated");
const files = {
  "open_Groth16Verifier.sol": "OpenGroth16.sol",
  "close_Groth16Verifier.sol": "CloseGroth16.sol",
  "modify_Groth16Verifier.sol": "ModifyGroth16.sol",
  "claim-liquidated_Groth16Verifier.sol": "ClaimGroth16.sol",
};
await mkdir(destination, { recursive: true });
for (const [source, target] of Object.entries(files)) {
  const contents = await readFile(path.join(releaseRoot, source), "utf8");
  const contractName = path.basename(target, ".sol");
  if (!contents.includes(`contract ${contractName}`)) throw new Error(`PERPS_VERIFIER_NAME_MISMATCH_${contractName}`);
  await copyFile(path.join(releaseRoot, source), path.join(destination, target));
}
console.log(`Staged ${Object.keys(files).length} hash-pinned Perps verifiers`);
