import { privateVaultV2Abi } from "@zkblast/abi";
import {
  shieldedTermsHashV2,
  shieldedTermsLimbsV2,
  validateShieldedTermsV2,
  assertCanonicalFieldV2,
  type ShieldedTermsV2,
} from "@zkblast/sdk";
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  keccak256,
  type Hex,
} from "viem";
import type { NoteScopeV2 } from "./notecrypto-v2";

const reserve = getAbiItem({ abi: privateVaultV2Abi, name: "reserve" });
const reservation = getAbiItem({ abi: privateVaultV2Abi, name: "reservation" });
const statementParameters = [
  reserve.inputs[0],
  reserve.inputs[1],
  reserve.inputs[2],
] as const;
export type ActionInputsV2 = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];
export const fieldHexV2 = (value: bigint): Hex =>
  `0x${value.toString(16).padStart(64, "0")}`;

export function encodeActionStatementV2(
  terms: ShieldedTermsV2,
  inputs: ActionInputsV2,
  crossings: number,
): Hex {
  validateShieldedTermsV2(terms);
  const encoded = encodeAbiParameters(statementParameters, [
    {
      ...terms,
      action:
        terms.action === "swap" ? 2 : terms.action === "add-liquidity" ? 3 : 4,
      model: terms.model === "damm" ? 0 : 1,
      binId: Number(terms.binId),
    },
    inputs,
    crossings,
  ]);
  decodeActionStatementV2(encoded, {
    environment: "testnet",
    chainId: String(terms.chainId),
    settlement: terms.settlement,
    treeVersion: String(inputs[3]),
  });
  return encoded;
}

/** Public calldata only. An encrypted backup is not authority to bypass these bindings. */
export function decodeActionStatementV2(statement: Hex, scope: NoteScopeV2) {
  if (statement.length > 32768) throw new Error("V2_STATEMENT_TOO_LARGE");
  const [terms, inputs, crossings] = decodeAbiParameters(
    statementParameters,
    statement,
  );
  for (const value of inputs) assertCanonicalFieldV2(value);
  if (inputs[4] === 0n || inputs.slice(23).some((value) => value >= 2n ** 128n))
    throw new Error("INVALID_V2_STATEMENT_AMOUNTS");
  if (
    encodeAbiParameters(statementParameters, [
      terms,
      inputs,
      crossings,
    ]).toLowerCase() !== statement.toLowerCase()
  )
    throw new Error("NONCANONICAL_V2_STATEMENT");
  const action =
    terms.action === 2
      ? "swap"
      : terms.action === 3
        ? "add-liquidity"
        : terms.action === 4
          ? "remove-liquidity"
          : null;
  if (!action || (terms.model !== 0 && terms.model !== 1))
    throw new Error("INVALID_V2_ACTION");
  const sdkTerms: ShieldedTermsV2 = {
    ...terms,
    action,
    model: terms.model === 0 ? "damm" : "dlmm",
    binId: BigInt(terms.binId),
  };
  validateShieldedTermsV2(sdkTerms);
  const limbs = shieldedTermsLimbsV2(shieldedTermsHashV2(sdkTerms));
  if (
    scope.environment !== "testnet" ||
    inputs[0] !== 2n ||
    inputs[1] !== BigInt(scope.chainId) ||
    terms.chainId !== inputs[1] ||
    inputs[2] !== BigInt(scope.settlement) ||
    terms.settlement.toLowerCase() !== scope.settlement.toLowerCase() ||
    inputs[3] !== BigInt(scope.treeVersion) ||
    inputs[5] !== BigInt(terms.action) ||
    inputs[6] !== BigInt(limbs.terms_low) ||
    inputs[7] !== BigInt(limbs.terms_high) ||
    inputs[8] !== terms.deadline ||
    inputs[9] !== BigInt(terms.asset0) ||
    inputs[10] !== BigInt(terms.asset1) ||
    inputs[11] !== BigInt(terms.pool) ||
    inputs[12] !== BigInt(terms.model) ||
    inputs[13] !== BigInt(terms.binId) + 8388608n ||
    inputs[17] !== BigInt(terms.outputCommitment0) ||
    inputs[18] !== BigInt(terms.outputCommitment1)
  )
    throw new Error("V2_STATEMENT_BINDING_MISMATCH");
  // This UI release charges no relayer fee; restored terms cannot silently add one.
  if (
    terms.maximumFee0 !== 0n ||
    terms.maximumFee1 !== 0n ||
    inputs.slice(29).some((value) => value !== 0n)
  )
    throw new Error("V2_UNEXPECTED_RELAYER_FEE");
  const nullifiers = inputs.slice(14, 17).map(fieldHexV2) as [Hex, Hex, Hex];
  const settlementCommitments = inputs.slice(17, 20).map(fieldHexV2) as [
    Hex,
    Hex,
    Hex,
  ];
  const refundCommitments = inputs.slice(20, 23).map(fieldHexV2) as [
    Hex,
    Hex,
    Hex,
  ];
  if (
    keccak256(
      encodeAbiParameters([{ type: "bytes32[3]" }], [refundCommitments]),
    ) !== terms.refundCommitment
  )
    throw new Error("V2_REFUND_DIGEST_MISMATCH");
  const statementHash = keccak256(statement);
  const id = keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        reservation.outputs[0],
      ],
      [
        "ZKBLAST_INTENT_V2",
        inputs[1],
        scope.settlement,
        {
          statementHash,
          deadline: terms.deadline,
          nullifiers,
          settlementCommitments,
          refundCommitments,
        },
      ],
    ),
  );
  return { id, terms, sdkTerms, inputs, crossings, action };
}

export function encodeReservationV2(
  statement: Hex,
  scope: NoteScopeV2,
  proof: Hex,
): Hex {
  const decoded = decodeActionStatementV2(statement, scope);
  if (!/^0x[0-9a-f]{512}$/iu.test(proof))
    throw new Error("INVALID_V2_PROOF_ENCODING");
  return encodeFunctionData({
    abi: privateVaultV2Abi,
    functionName: "reserve",
    args: [decoded.terms, decoded.inputs, decoded.crossings, proof],
  });
}
