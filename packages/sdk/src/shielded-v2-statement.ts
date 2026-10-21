import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import {
  assertCanonicalFieldV2,
  shieldedTermsLimbsV2,
} from "./shielded-v2-note.js";
import type { ShieldedActionV2 } from "./shielded-v2-terms.js";

type Triple = readonly [bigint, bigint, bigint];

/** Public information only; never add note secrets or paths to this type. */
export type PrivateActionStatementV2 = Readonly<{
  schemaVersion: 2;
  chainId: bigint;
  settlement: Address;
  treeVersion: bigint;
  merkleRoot: bigint;
  action: ShieldedActionV2;
  termsHash: Hex;
  deadline: bigint;
  asset0: Address;
  asset1: Address;
  pool: Address;
  model: "damm" | "dlmm";
  binId: bigint;
  nullifiers: Triple;
  outputCommitments: Triple;
  refundCommitments: Triple;
  poolInflows: Triple;
  poolOutflows: Triple;
  fees: Triple;
}>;

const actionCodes = {
  swap: 2n,
  "add-liquidity": 3n,
  "remove-liquidity": 4n,
} as const;

function address(value: Address): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || BigInt(value) === 0n)
    throw new Error("Invalid v2 public address");
  return BigInt(value);
}

function bounded(value: bigint, bits: number): void {
  if (value < 0n || value >= 1n << BigInt(bits))
    throw new Error("Public amount outside circuit bounds");
}

/** Exact action.circom public-input order, verified against the compiler .sym. */
export function privateActionPublicInputsV2(
  statement: PrivateActionStatementV2,
) {
  const s = statement;
  if (s.schemaVersion !== 2 || !Object.hasOwn(actionCodes, s.action))
    throw new Error("Invalid v2 action schema");
  for (const value of [s.chainId, s.treeVersion, s.deadline]) {
    bounded(value, 64);
    if (value === 0n) throw new Error("Missing v2 context");
  }
  const settlement = address(s.settlement),
    asset0 = address(s.asset0),
    asset1 = address(s.asset1),
    pool = address(s.pool);
  if (asset0 >= asset1) throw new Error("Pair is not canonical");
  if (s.model !== "damm" && s.model !== "dlmm")
    throw new Error("Unknown v2 pool model");
  if (
    s.binId < -(1n << 23n) ||
    s.binId >= 1n << 23n ||
    (s.model === "damm" && s.binId !== 0n)
  )
    throw new Error("Invalid v2 pool bin");
  assertCanonicalFieldV2(s.merkleRoot);
  if (s.merkleRoot === 0n) throw new Error("Missing Merkle root");
  for (const values of [
    s.nullifiers,
    s.outputCommitments,
    s.refundCommitments,
  ]) {
    if (values.length !== 3) throw new Error("Expected three resource slots");
    const enabled = values.filter((value) => value !== 0n);
    if (enabled.length === 0 || new Set(enabled).size !== enabled.length)
      throw new Error("Missing or duplicate note identifier");
    for (const value of values) assertCanonicalFieldV2(value);
  }
  for (const values of [s.poolInflows, s.poolOutflows, s.fees]) {
    if (values.length !== 3) throw new Error("Expected three resource amounts");
    for (const value of values) bounded(value, 128);
  }
  if (s.fees[2] !== 0n) throw new Error("LP shares cannot pay fees");
  const limbs = shieldedTermsLimbsV2(s.termsHash);
  return [
    2n,
    s.chainId,
    settlement,
    s.treeVersion,
    s.merkleRoot,
    actionCodes[s.action],
    BigInt(limbs.terms_low),
    BigInt(limbs.terms_high),
    s.deadline,
    asset0,
    asset1,
    pool,
    s.model === "damm" ? 0n : 1n,
    s.binId + (1n << 23n),
    ...s.nullifiers,
    ...s.outputCommitments,
    ...s.refundCommitments,
    ...s.poolInflows,
    ...s.poolOutflows,
    ...s.fees,
  ] as const;
}

export function encodePrivateActionStatementV2(
  statement: PrivateActionStatementV2,
): Hex {
  return encodeAbiParameters(
    [{ type: "uint256[32]" }],
    [privateActionPublicInputsV2(statement)],
  );
}

export function privateActionStatementHashV2(
  statement: PrivateActionStatementV2,
): Hex {
  return keccak256(encodePrivateActionStatementV2(statement));
}
