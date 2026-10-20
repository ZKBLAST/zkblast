import { randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeAbiParameters, toHex, type Address, type Hex } from "viem";
import {
  decryptNotes,
  encryptNotes,
  type Backup,
  type ShieldedNoteV1,
} from "../../../apps/web/src/lib/notecrypto.js";
import { check, readJson, root, saveJson } from "./shielded-mainnet-runtime.js";

type Input = Record<string, string | readonly string[]>;
type Proof = {
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
};
type SnarkJs = {
  wtns: {
    calculate: (input: Input, wasm: string, witness: string) => Promise<void>;
    exportJson: (witness: string) => Promise<readonly string[]>;
  };
  groth16: {
    fullProve: (
      input: Input,
      wasm: string,
      key: string,
    ) => Promise<{ proof: Proof; publicSignals: readonly string[] }>;
    verify: (
      key: unknown,
      signals: readonly string[],
      proof: Proof,
    ) => Promise<boolean>;
  };
};
const backupPath = "deployments/mainnet/shielded-beta-backup.private.json";
const passphrasePath = path.join(
  root,
  "deployments/mainnet/shielded-beta-recovery.key",
);
const target = path.join(
  root,
  "packages/circuits/target/mainnet-beta-withdraw-v1",
);
const field = (value: string) => BigInt(value).toString();

export async function proofTools() {
  return (await import(
    pathToFileURL(
      path.join(root, "packages/circuits/node_modules/snarkjs/build/main.cjs"),
    ).href
  )) as SnarkJs;
}
async function passphrase() {
  let value: string;
  try {
    check(
      ((await stat(passphrasePath)).mode & 0o077) === 0,
      "Recovery key permissions must be private",
    );
    value = await readFile(passphrasePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    value = randomBytes(32).toString("hex");
    await writeFile(passphrasePath, value, { flag: "wx", mode: 0o600 });
  }
  check(value.length === 64, "Invalid local recovery key");
  return value;
}
export async function saveNote(note: ShieldedNoteV1) {
  const password = await passphrase();
  const backup = await encryptNotes([note], password, "mainnet", 4663);
  await saveJson(backupPath, backup);
  const restored = await decryptNotes(
    await readJson<Backup>(backupPath),
    password,
    { environment: "mainnet", chainId: 4663 },
  );
  check(
    restored.length === 1 && restored[0]?.commitment === note.commitment,
    "Encrypted backup restore failed",
  );
}
export async function acceptanceNote(
  vault: Address,
  asset: Address,
  siblings: readonly Hex[],
) {
  try {
    const [note] = await decryptNotes(
      await readJson<Backup>(backupPath),
      await passphrase(),
      { environment: "mainnet", chainId: 4663 },
    );
    check(
      note &&
        note.vaultAddress.toLowerCase() === vault.toLowerCase() &&
        note.assetAddress.toLowerCase() === asset.toLowerCase() &&
        note.amountRaw === "1000000",
      "Recovery note context mismatch",
    );
    return note;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const note: ShieldedNoteV1 = {
    format: "zkblast-note",
    version: 1,
    environment: "mainnet",
    chainId: 4663,
    vaultAddress: vault,
    treeVersion: 1,
    assetAddress: asset,
    amountRaw: "1000000",
    secret: BigInt(`0x${randomBytes(31).toString("hex")}`).toString(),
    nonce: BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
    commitment: "1",
    leafIndex: null,
    transactionHash: null,
    createdAt: new Date().toISOString(),
    status: "prepared",
  };
  const values = await noteValues(note, siblings);
  const complete = { ...note, commitment: String(values[1]) };
  await saveNote(complete);
  return complete;
}
export async function noteValues(
  note: ShieldedNoteV1,
  siblings: readonly Hex[],
) {
  const tools = await proofTools();
  const witness = path.join(target, "acceptance-vector.wtns");
  await tools.wtns.calculate(
    {
      chain_id: String(note.chainId),
      vault_address: field(note.vaultAddress),
      asset_address: field(note.assetAddress),
      amount: note.amountRaw,
      secret: note.secret,
      nonce: note.nonce,
      path_siblings: siblings.map(field),
      path_directions: Array.from({ length: 32 }, () => "0"),
    },
    path.join(
      root,
      "packages/circuits/target/v1-vector/vector-generator_js/vector-generator.wasm",
    ),
    witness,
  );
  return tools.wtns.exportJson(witness);
}
export async function withdrawalPayload(
  note: ShieldedNoteV1,
  siblings: readonly Hex[],
  recipient: Address,
) {
  const values = await noteValues(note, siblings);
  check(String(values[1]) === note.commitment, "Local commitment mismatch");
  const inputs = [
    "1",
    "1",
    String(note.chainId),
    field(note.vaultAddress),
    "1",
    String(values[2]),
    String(values[3]),
    field(note.assetAddress),
    note.amountRaw,
    field(recipient),
    field(recipient),
    "0",
    String(Math.floor(Date.now() / 1000) + 3600),
  ];
  const names = [
    "schema_version",
    "action",
    "chain_id",
    "vault_address",
    "tree_version",
    "merkle_root",
    "nullifier",
    "asset_address",
    "amount",
    "recipient_address",
    "relayer_address",
    "relayer_fee",
    "deadline",
  ];
  const input: Input = Object.fromEntries(
    names.map((name, index) => [name, inputs[index]!]),
  );
  Object.assign(input, {
    secret: note.secret,
    nonce: note.nonce,
    leaf_index: "0",
    path_siblings: siblings.map(field),
    path_directions: Array.from({ length: 32 }, () => "0"),
  });
  const tools = await proofTools();
  const result = await tools.groth16.fullProve(
    input,
    path.join(target, "withdraw.wasm"),
    path.join(target, "withdraw_final.zkey"),
  );
  check(
    result.publicSignals.length === 13 &&
      result.publicSignals.every(
        (signal, index) => BigInt(signal) === BigInt(inputs[index]!),
      ),
    "Prover public inputs mismatch",
  );
  check(
    await tools.groth16.verify(
      JSON.parse(
        await readFile(path.join(target, "verification_key.json"), "utf8"),
      ),
      result.publicSignals,
      result.proof,
    ),
    "Local proof invalid",
  );
  const { proof } = result;
  const encoded = encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [
      [BigInt(proof.pi_a[0]!), BigInt(proof.pi_a[1]!)],
      [
        [BigInt(proof.pi_b[0]![1]!), BigInt(proof.pi_b[0]![0]!)],
        [BigInt(proof.pi_b[1]![1]!), BigInt(proof.pi_b[1]![0]!)],
      ],
      [BigInt(proof.pi_c[0]!), BigInt(proof.pi_c[1]!)],
    ],
  );
  return {
    encoded,
    inputs,
    root: toHex(BigInt(inputs[5]!), { size: 32 }),
    nullifier: toHex(BigInt(inputs[6]!), { size: 32 }),
  };
}
