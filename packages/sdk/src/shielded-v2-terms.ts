import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** Draft v2 settlement specification, not a proof or an executable transaction.
 * Never reinterpret withdrawal-v1 notes as v2 notes or use this hash as ownership
 * authorization. A separate verifier must enforce membership and conservation.
 */
export const SHIELDED_V2_DOMAIN = keccak256(
  new TextEncoder().encode("ZKBLAST_SHIELDED_SETTLEMENT_V2"),
);

export type ShieldedActionV2 = "swap" | "add-liquidity" | "remove-liquidity";

export type ShieldedTermsV2 = Readonly<{
  chainId: bigint;
  settlement: Address;
  action: ShieldedActionV2;
  pool: Address;
  model: "damm" | "dlmm";
  binId: bigint;
  asset0: Address;
  asset1: Address;
  amount0: bigint;
  amount1: bigint;
  shares: bigint;
  minimum0: bigint;
  minimum1: bigint;
  minimumShares: bigint;
  maximumFee0: bigint;
  maximumFee1: bigint;
  feeRecipient: Address;
  deadline: bigint;
  /** Keccak digest of the three proof-bound refund commitments, not a note leaf. */
  refundCommitment: Hex;
  outputCommitment0: Hex; // Token0 slot; zero when disabled.
  outputCommitment1: Hex; // Token1 slot; LP output is separately in the statement.
}>;

const actions = { swap: 2, "add-liquidity": 3, "remove-liquidity": 4 } as const;
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const wordPattern = /^0x[0-9a-fA-F]{64}$/u;

function uint(value: bigint, bits: number, name: string): void {
  if (value < 0n || value >= 1n << BigInt(bits)) {
    throw new Error(`${name} is outside uint${bits}`);
  }
}

function nonzeroHex(value: string, pattern: RegExp, name: string): void {
  if (!pattern.test(value) || BigInt(value) === 0n) {
    throw new Error(`${name} must be nonzero and correctly encoded`);
  }
}

export function validateShieldedTermsV2(terms: ShieldedTermsV2): void {
  if (!Object.hasOwn(actions, terms.action))
    throw new Error("Unsupported v2 action");
  if (terms.model !== "damm" && terms.model !== "dlmm") {
    throw new Error("Unsupported pool model");
  }
  uint(terms.chainId, 64, "chainId");
  uint(terms.deadline, 64, "deadline");
  if (terms.chainId === 0n || terms.deadline === 0n) {
    throw new Error("Network and deadline are required");
  }
  for (const name of [
    "settlement",
    "pool",
    "asset0",
    "asset1",
    "feeRecipient",
  ] as const) {
    nonzeroHex(terms[name], addressPattern, name);
  }
  if (BigInt(terms.asset0) >= BigInt(terms.asset1)) {
    throw new Error("Assets must be distinct and canonically sorted");
  }
  if (terms.binId < -(1n << 23n) || terms.binId >= 1n << 23n) {
    throw new Error("binId is outside int24");
  }
  if (terms.model === "damm" && terms.binId !== 0n) {
    throw new Error("DAMM does not support bin selection");
  }
  for (const name of [
    "amount0",
    "amount1",
    "shares",
    "minimum0",
    "minimum1",
    "minimumShares",
    "maximumFee0",
    "maximumFee1",
  ] as const)
    uint(terms[name], 128, name);
  nonzeroHex(terms.refundCommitment, wordPattern, "refund digest");
  const commitments = [terms.outputCommitment0, terms.outputCommitment1];
  for (const commitment of commitments) {
    if (!wordPattern.test(commitment))
      throw new Error("Invalid output commitment encoding");
  }
  const enabled = commitments.filter((value) => BigInt(value) !== 0n);
  if (
    new Set(enabled.map((value) => value.toLowerCase())).size !== enabled.length
  ) {
    throw new Error("Enabled output commitments must be distinct");
  }
  if (terms.action === "swap") {
    if (enabled.length === 0) throw new Error("Swap needs token output notes");
    if (
      (terms.amount0 === 0n) === (terms.amount1 === 0n) ||
      terms.shares !== 0n ||
      terms.minimumShares !== 0n
    ) {
      throw new Error("Swap requires exactly one input and no LP shares");
    }
    if (
      terms.amount0 > 0n
        ? terms.minimum0 !== 0n || terms.minimum1 === 0n
        : terms.minimum1 !== 0n || terms.minimum0 === 0n
    ) {
      throw new Error("Swap minimum must bind the output asset only");
    }
  } else if (terms.action === "add-liquidity") {
    if (
      terms.amount0 + terms.amount1 === 0n ||
      terms.shares !== 0n ||
      terms.minimumShares === 0n ||
      terms.minimum0 !== 0n ||
      terms.minimum1 !== 0n
    ) {
      throw new Error(
        "LP add requires asset inputs and a minimum share output",
      );
    }
    if (terms.amount0 === 0n || terms.amount1 === 0n) {
      throw new Error("Current pool implementations require both assets");
    }
  } else if (
    terms.shares === 0n ||
    terms.amount0 !== 0n ||
    terms.amount1 !== 0n ||
    terms.minimumShares !== 0n ||
    terms.minimum0 + terms.minimum1 === 0n ||
    enabled.length === 0
  ) {
    throw new Error(
      "LP removal requires share input and bounded asset outputs",
    );
  }
}

/** ABI encoding is explicit and Solidity-compatible; no ambiguous concatenation. */
export function shieldedTermsHashV2(terms: ShieldedTermsV2): Hex {
  validateShieldedTermsV2(terms);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint64" },
        { type: "address" },
        { type: "uint8" },
        { type: "address" },
        { type: "uint8" },
        { type: "int24" },
        { type: "address" },
        { type: "address" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "address" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        SHIELDED_V2_DOMAIN,
        terms.chainId,
        terms.settlement,
        actions[terms.action],
        terms.pool,
        terms.model === "damm" ? 0 : 1,
        Number(terms.binId),
        terms.asset0,
        terms.asset1,
        terms.amount0,
        terms.amount1,
        terms.shares,
        terms.minimum0,
        terms.minimum1,
        terms.minimumShares,
        terms.maximumFee0,
        terms.maximumFee1,
        terms.feeRecipient,
        terms.deadline,
        terms.refundCommitment,
        terms.outputCommitment0,
        terms.outputCommitment1,
      ],
    ),
  );
}
