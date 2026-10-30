import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const kinds = ["open", "close", "modify", "claim-liquidated"];
const publicInputs = { open: 21, close: 17, modify: 19, "claim-liquidated": 16 };
const sourceNames = {
  open: "open.circom",
  close: "close.circom",
  modify: "modify.circom",
  "claim-liquidated": "claim-liquidated.circom",
};
const verifierNames = {
  open: "OpenGroth16",
  close: "CloseGroth16",
  modify: "ModifyGroth16",
  "claim-liquidated": "ClaimGroth16",
};

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const environment = argument("environment");
const chainId = argument("chain-id");
const adapter = argument("adapter");
const setupRoot = argument("setup-root");
const outputRoot = argument("output-root");
if (
  !["testnet", "mainnet"].includes(environment) || !/^[1-9][0-9]*$/u.test(chainId ?? "")
    || !/^0x[0-9a-fA-F]{40}$/u.test(adapter ?? "") || BigInt(adapter) === 0n
    || !setupRoot || !outputRoot
) {
  throw new Error(
    "Usage: --environment testnet|mainnet --chain-id <id> --adapter <address> "
      + "--setup-root <isolated setup directory> --output-root <staging directory>",
  );
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalizedAdapter = adapter.toLowerCase();
const snarkjs = path.join(root, "node_modules/.bin/snarkjs");
const releases = {};
const calculatorSource = path.resolve(setupRoot, "position-vector/position-vector.wasm");
const calculatorDestination = path.resolve(outputRoot, "position-vector.wasm");
await mkdir(path.resolve(outputRoot), { recursive: true });
await copyFile(calculatorSource, calculatorDestination);
const calculatorBytes = await readFile(calculatorDestination);

for (const kind of kinds) {
  const sourceDirectory = path.resolve(setupRoot, kind);
  const destination = path.resolve(outputRoot);
  await mkdir(destination, { recursive: true });
  const wasmSource = path.join(sourceDirectory, `${kind}.wasm`);
  const zkeySource = path.join(sourceDirectory, `${kind}_final.zkey`);
  const wasmDestination = path.join(destination, `${kind}.wasm`);
  const zkeyDestination = path.join(destination, `${kind}_final.zkey`);
  const verificationKeyDestination = path.join(destination, `${kind}_verification_key.json`);
  const verifierDestination = path.join(destination, `${kind}_Groth16Verifier.sol`);
  await copyFile(wasmSource, wasmDestination);
  await copyFile(zkeySource, zkeyDestination);
  await run(snarkjs, ["zkey", "export", "verificationkey", zkeyDestination, verificationKeyDestination]);
  await run(snarkjs, ["zkey", "export", "solidityverifier", zkeyDestination, verifierDestination]);
  const generatedVerifier = await readFile(verifierDestination, "utf8");
  const renamedVerifier = generatedVerifier.replace(
    "contract Groth16Verifier",
    `contract ${verifierNames[kind]}`,
  );
  if (renamedVerifier === generatedVerifier) throw new Error(`Generated verifier rename failed for ${kind}`);
  await writeFile(verifierDestination, renamedVerifier);

  const [wasm, zkey, verificationKey, verifier, circuitSource, sharedPositionSource] = await Promise.all([
    readFile(wasmDestination),
    readFile(zkeyDestination),
    readFile(verificationKeyDestination),
    readFile(verifierDestination),
    readFile(path.join(root, "src/perps", sourceNames[kind])),
    readFile(path.join(root, "src/perps/position.circom")),
  ]);
  const parsedVerificationKey = JSON.parse(verificationKey.toString("utf8"));
  if (
    parsedVerificationKey.protocol !== "groth16" || parsedVerificationKey.curve !== "bn128"
      || parsedVerificationKey.nPublic !== publicInputs[kind]
  ) throw new Error(`Verification key public-input mismatch for ${kind}`);

  const prefix = `/zk/${environment}/perps-v1/`;
  const manifest = {
    schemaVersion: 1,
    feature: "shielded-perps",
    kind,
    environment,
    chainId,
    adapter: normalizedAdapter,
    publicInputs: publicInputs[kind],
    proofSystem: "groth16",
    curve: "bn128",
    sources: {
      circuitSha256: sha256(circuitSource),
      positionSha256: sha256(sharedPositionSource),
      verifierSha256: sha256(verifier),
    },
    assets: {
      wasm: { path: `${prefix}${kind}.wasm`, sha256: sha256(wasm) },
      zkey: { path: `${prefix}${kind}_final.zkey`, sha256: sha256(zkey) },
      verificationKey: {
        path: `${prefix}${kind}_verification_key.json`,
        sha256: sha256(verificationKey),
      },
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(destination, `${kind}-manifest.json`), manifestBytes);
  releases[kind] = {
    manifestPath: `${prefix}${kind}-manifest.json`,
    manifestSha256: sha256(manifestBytes),
    generatedVerifierSha256: sha256(verifier),
  };
}

const index = {
  schemaVersion: 1,
  feature: "shielded-perps",
  environment,
  chainId,
  adapter: normalizedAdapter,
  positionCalculator: {
    path: `/zk/${environment}/perps-v1/position-vector.wasm`,
    sha256: sha256(calculatorBytes),
  },
  actions: releases,
};
await writeFile(path.resolve(outputRoot, "manifest.json"), `${JSON.stringify(index, null, 2)}\n`);
process.stdout.write(`Prepared hash-pinned ${environment} Perps release for ${chainId}\n`);
