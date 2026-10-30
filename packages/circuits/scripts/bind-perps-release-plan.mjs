import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const environment of ["testnet", "mainnet"]) {
  const planPath = path.join(root, `deployments/${environment}/perps-v1-plan.json`);
  const releaseRoot = path.join(root, `packages/circuits/target/perps-v1-release-${environment}`);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const indexBytes = await readFile(path.join(releaseRoot, "manifest.json"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  if (
    index.environment !== environment || index.chainId !== String(plan.chainId)
      || index.adapter.toLowerCase() !== plan.addresses.ShieldedPerpAdapterProxy.toLowerCase()
  ) throw new Error(`PERPS_RELEASE_PLAN_SCOPE_MISMATCH_${environment}`);
  const actions = {};
  for (const kind of ["open", "close", "modify", "claim-liquidated"]) {
    const manifestBytes = await readFile(path.join(releaseRoot, `${kind}-manifest.json`));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const verifierBytes = await readFile(path.join(releaseRoot, `${kind}_Groth16Verifier.sol`));
    if (
      sha256(manifestBytes) !== index.actions[kind].manifestSha256
        || sha256(verifierBytes) !== index.actions[kind].generatedVerifierSha256
        || manifest.adapter.toLowerCase() !== index.adapter.toLowerCase()
        || manifest.chainId !== index.chainId
    ) throw new Error(`PERPS_RELEASE_HASH_MISMATCH_${environment}_${kind}`);
    actions[kind] = {
      manifestSha256: sha256(manifestBytes),
      generatedVerifierSha256: sha256(verifierBytes),
      zkeySha256: manifest.assets.zkey.sha256,
      wasmSha256: manifest.assets.wasm.sha256,
      verificationKeySha256: manifest.assets.verificationKey.sha256,
    };
  }
  plan.proverRelease = {
    environment,
    chainId: index.chainId,
    adapter: index.adapter,
    indexSha256: sha256(indexBytes),
    actions,
    published: false,
  };
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(planPath, serialized);
  process.stdout.write(`${environment} ${sha256(Buffer.from(serialized))}\n`);
}
