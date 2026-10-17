import { readFile } from "node:fs/promises";

const schema = JSON.parse(
  await readFile(
    new URL("../architecture/withdraw-v1.json", import.meta.url),
    "utf8",
  ),
);
const expected = [
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
if (schema.protocol !== "ZKBLAST" || schema.schemaVersion !== 1)
  throw new Error("INVALID_CIRCUIT_SCHEMA_IDENTITY");
if (JSON.stringify(schema.publicInputs) !== JSON.stringify(expected))
  throw new Error("PUBLIC_INPUT_ORDER_CHANGED");
if (schema.tree.depth !== 32 || schema.tree.rootHistorySize !== 256)
  throw new Error("INVALID_TREE_POLICY");
if (BigInt(schema.field.modulus) <= 0n)
  throw new Error("INVALID_FIELD_MODULUS");
console.log(
  `Circuit architecture valid: ${expected.length} ordered public inputs`,
);
