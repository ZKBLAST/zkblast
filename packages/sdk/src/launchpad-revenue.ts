import { launchpadRevenueSplitterAbi } from "@zkblast/abi";
import { getAddress, type Address, type Hex } from "viem";

import type { PreparedContractCall } from "./calls.js";

export const launchpadRevenueKinds = {
  tradeFee: 0,
  poolFee: 1,
  graduationFee: 2,
  lpReward: 3,
} as const;

export const launchpadRevenueLabels = {
  [launchpadRevenueKinds.tradeFee]: "Trade fees",
  [launchpadRevenueKinds.poolFee]: "Pool fees",
  [launchpadRevenueKinds.graduationFee]: "Graduation fees",
  [launchpadRevenueKinds.lpReward]: "LP rewards",
} as const;

export type LaunchpadRevenueKind =
  (typeof launchpadRevenueKinds)[keyof typeof launchpadRevenueKinds];

export class LaunchpadRevenueClient {
  readonly splitter: Address;

  constructor(splitter: Address) {
    this.splitter = getAddress(splitter);
  }

  claimable(recipient: Address, asset: Address) {
    return {
      address: this.splitter,
      abi: launchpadRevenueSplitterAbi,
      functionName: "claimable",
      args: [getAddress(recipient), getAddress(asset)],
    } as const;
  }

  claimableForSnapshot(snapshotId: Hex, recipient: Address) {
    return {
      address: this.splitter,
      abi: launchpadRevenueSplitterAbi,
      functionName: "claimableBySnapshot",
      args: [snapshotId, getAddress(recipient)],
    } as const;
  }

  accrued(snapshotId: Hex, kind: LaunchpadRevenueKind) {
    return {
      address: this.splitter,
      abi: launchpadRevenueSplitterAbi,
      functionName: "accruedByKind",
      args: [snapshotId, kind],
    } as const;
  }

  reconciliation(asset: Address) {
    return {
      address: this.splitter,
      abi: launchpadRevenueSplitterAbi,
      functionName: "reconciliation",
      args: [getAddress(asset)],
    } as const;
  }

  claim(snapshotId: Hex): PreparedContractCall {
    return {
      address: this.splitter,
      abi: launchpadRevenueSplitterAbi,
      functionName: "claim",
      args: [snapshotId],
    };
  }
}
