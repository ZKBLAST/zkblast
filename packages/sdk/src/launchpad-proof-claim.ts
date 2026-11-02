import { launchpadProofClaimAdapterAbi } from "@zkblast/abi";
import { getAddress, isAddress, type Address, type Hex } from "viem";

import type { PreparedContractCall } from "./calls.js";
import { SdkError } from "./errors.js";

const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type LaunchpadClaimContext = Readonly<{
  chainId: bigint;
  adapter: Address;
  launchpadId: bigint;
  pool: Address;
  snapshotId: Hex;
  recipient: Address;
  asset: Address;
  maximumAmount: bigint;
  deadline: bigint;
  nullifier: bigint;
  authorizationCommitment: bigint;
}>;

export function launchpadClaimPublicInputs(context: LaunchpadClaimContext) {
  if (!isAddress(context.adapter) || !isAddress(context.pool) || !isAddress(context.recipient) || !isAddress(context.asset)) {
    throw new SdkError("LAUNCHPAD_PROOF_CONTEXT_INVALID", "Claim context contains an invalid address");
  }
  const snapshot = BigInt(context.snapshotId);
  const values = [
    1n, 1n, context.chainId, BigInt(getAddress(context.adapter)), 1n,
    context.launchpadId, BigInt(getAddress(context.pool)), snapshot & UINT128_MAX,
    snapshot >> 128n, BigInt(getAddress(context.recipient)), BigInt(getAddress(context.asset)),
    context.maximumAmount, context.deadline, context.nullifier, context.authorizationCommitment,
  ] as const;
  if (
    context.chainId <= 0n || context.chainId > UINT64_MAX || context.launchpadId <= 0n
    || context.launchpadId > UINT128_MAX || context.maximumAmount <= 0n
    || context.maximumAmount > UINT128_MAX || context.deadline <= 0n || context.deadline > UINT64_MAX
    || values.some((value) => value < 0n || value >= FIELD)
  ) throw new SdkError("LAUNCHPAD_PROOF_CONTEXT_INVALID", "Claim context exceeds its canonical field range");
  return values;
}

export function prepareLaunchpadProofClaim(
  context: LaunchpadClaimContext,
  proof: Hex,
): PreparedContractCall {
  if (!/^0x[0-9a-f]*$/iu.test(proof) || proof.length <= 2) {
    throw new SdkError("LAUNCHPAD_PROOF_INVALID", "A non-empty encoded proof is required");
  }
  return {
    address: getAddress(context.adapter),
    abi: launchpadProofClaimAdapterAbi,
    functionName: "claimWithProof",
    args: [proof, launchpadClaimPublicInputs(context)],
  };
}

export function prepareLaunchpadAuthorizationCommitment(
  adapter: Address,
  snapshotId: Hex,
  commitment: bigint,
): PreparedContractCall {
  if (commitment <= 0n || commitment >= FIELD) {
    throw new SdkError("LAUNCHPAD_COMMITMENT_INVALID", "Authorization commitment is outside the scalar field");
  }
  return {
    address: getAddress(adapter),
    abi: launchpadProofClaimAdapterAbi,
    functionName: "setAuthorizationCommitment",
    args: [snapshotId, `0x${commitment.toString(16).padStart(64, "0")}`],
  };
}
