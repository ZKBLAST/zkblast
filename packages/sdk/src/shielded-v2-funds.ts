import type { Address } from "viem";
import { assertCanonicalFieldV2 } from "./shielded-v2-note.js";

type Context = Readonly<{
  schemaVersion: 2;
  chainId: bigint;
  settlement: Address;
  treeVersion: bigint;
  asset: Address;
  amount: bigint;
}>;

/** Public v2 funding statement only. Note secrets/paths are not API parameters. */
export type FundStatementV2 = Context &
  Readonly<
    | { operation: "deposit"; commitment: bigint }
    | {
        operation: "withdraw";
        merkleRoot: bigint;
        nullifier: bigint;
        recipient: Address;
      }
  >;

function address(value: Address): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || BigInt(value) === 0n)
    throw new Error("Invalid v2 funding address");
  return BigInt(value);
}

function field(value: bigint): bigint {
  assertCanonicalFieldV2(value);
  if (value === 0n) throw new Error("Missing v2 funding identifier");
  return value;
}

/** Exact fund.circom / PrivateVaultV2 order, never the withdrawal-v1 ABI. */
export function fundPublicInputsV2(s: FundStatementV2) {
  if (s.schemaVersion !== 2)
    throw new Error("Funding requires native v2 notes");
  for (const value of [s.chainId, s.treeVersion]) {
    if (value <= 0n || value >= 1n << 64n)
      throw new Error("Invalid v2 funding context");
  }
  if (s.amount <= 0n || s.amount >= 1n << 128n)
    throw new Error("Invalid v2 funding amount");
  if (s.operation !== "deposit" && s.operation !== "withdraw")
    throw new Error("Unknown funding operation");
  const withdrawal = s.operation === "withdraw";
  return [
    2n,
    withdrawal ? 1n : 0n,
    s.chainId,
    address(s.settlement),
    s.treeVersion,
    withdrawal ? field(s.merkleRoot) : 0n,
    withdrawal ? field(s.nullifier) : 0n,
    address(s.asset),
    s.amount,
    withdrawal ? address(s.recipient) : 0n,
    withdrawal ? 0n : field(s.commitment),
  ] as const;
}
