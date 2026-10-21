import type { Address, Hex } from "viem";

export type ShieldedResourceV2 = Readonly<
  | { kind: "token"; address: Address }
  | { kind: "lp"; address: Address; model: "damm" | "dlmm"; binId: bigint }
>;

/** Private witness material. Never include in API payloads, telemetry or receipts.
 * This type deliberately cannot represent or upgrade a withdrawal-v1 note.
 */
export type ShieldedNoteV2 = Readonly<{
  schemaVersion: 2;
  chainId: bigint;
  settlement: Address;
  treeVersion: bigint;
  resource: ShieldedResourceV2;
  amount: bigint;
  secret: bigint;
  nonce: bigint;
}>;

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function bounded(
  value: bigint,
  bits: number,
  name: string,
  nonzero = false,
): void {
  if (
    typeof value !== "bigint" ||
    value < (nonzero ? 1n : 0n) ||
    value >= 1n << BigInt(bits)
  ) {
    throw new Error(`Invalid v2 ${name}`);
  }
}

function address(value: Address, name: string): bigint {
  if (!addressPattern.test(value) || BigInt(value) === 0n)
    throw new Error(`Invalid v2 ${name}`);
  return BigInt(value);
}

export function shieldedNoteWitnessV2(
  note: ShieldedNoteV2,
): Record<string, string> {
  if (note.schemaVersion !== 2)
    throw new Error("Only native v2 notes are accepted");
  bounded(note.chainId, 64, "chainId", true);
  bounded(note.treeVersion, 64, "treeVersion", true);
  bounded(note.amount, 128, "amount", true);
  bounded(note.secret, 248, "secret", true);
  bounded(note.nonce, 128, "nonce");
  const resource = note.resource;
  if (resource.kind !== "token" && resource.kind !== "lp")
    throw new Error("Invalid v2 resource kind");
  let bin = 0n;
  let model = 0;
  if (resource.kind === "lp") {
    if (resource.model !== "damm" && resource.model !== "dlmm")
      throw new Error("Invalid v2 pool model");
    if (
      typeof resource.binId !== "bigint" ||
      resource.binId < -(1n << 23n) ||
      resource.binId >= 1n << 23n
    )
      throw new Error("Invalid v2 bin");
    if (resource.model === "damm" && resource.binId !== 0n)
      throw new Error("DAMM has no bins");
    bin = resource.binId;
    model = resource.model === "dlmm" ? 1 : 0;
  }
  return {
    chain_id: String(note.chainId),
    settlement: String(address(note.settlement, "settlement")),
    tree_version: String(note.treeVersion),
    resource_kind: resource.kind === "token" ? "0" : "1",
    resource_address: String(address(resource.address, "resource address")),
    pool_model: String(model),
    bin_index: String(bin + (1n << 23n)),
    amount: String(note.amount),
    secret: String(note.secret),
    nonce: String(note.nonce),
  };
}

/** Lossless 256-bit binding: never reduce a Keccak terms hash modulo BN254. */
export function shieldedTermsLimbsV2(hash: Hex): {
  terms_low: string;
  terms_high: string;
} {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(hash))
    throw new Error("Expected bytes32 terms hash");
  const value = BigInt(hash);
  return {
    terms_low: String(value & ((1n << 128n) - 1n)),
    terms_high: String(value >> 128n),
  };
}

/** Reject field aliases in public inputs before witness generation. */
export function assertCanonicalFieldV2(value: bigint): void {
  if (value < 0n || value >= BN254_SCALAR_FIELD)
    throw new Error("Noncanonical BN254 field value");
}
