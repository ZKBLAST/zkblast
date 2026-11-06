import { type Abi, type Address, type Hex } from "viem";
import type { PreparedContractCall } from "./calls.js";

export type RangeLiquidityBin = Readonly<{
  binId: number;
  amount0: bigint;
  amount1: bigint;
  minimumShares: bigint;
}>;

const rangePositionManagerAbi = [
  {
    type: "function",
    name: "createRangePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      {
        name: "additions",
        type: "tuple[]",
        components: [
          { name: "binId", type: "int24" },
          { name: "amount0", type: "uint256" },
          { name: "amount1", type: "uint256" },
          { name: "minimumShares", type: "uint256" },
        ],
      },
      { name: "expectedActiveBin", type: "int24" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "rangePositionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "increaseRangePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rangePositionId", type: "uint256" },
      {
        name: "additions",
        type: "tuple[]",
        components: [
          { name: "binId", type: "int24" },
          { name: "amount0", type: "uint256" },
          { name: "amount1", type: "uint256" },
          { name: "minimumShares", type: "uint256" },
        ],
      },
      { name: "expectedActiveBin", type: "int24" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "decreaseRangePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rangePositionId", type: "uint256" },
      { name: "shareBps", type: "uint16" },
      { name: "minimumAmount0", type: "uint256" },
      { name: "minimumAmount1", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }],
  },
] as const satisfies Abi;

export function buildCreateRangePosition(input: Readonly<{
  manager: Address;
  pool: Address;
  bins: readonly RangeLiquidityBin[];
  expectedActiveBin: number;
  deadline: bigint;
}>): PreparedContractCall {
  validateRangeBins(input.bins);
  return {
    address: input.manager,
    abi: rangePositionManagerAbi,
    functionName: "createRangePosition",
    args: [input.pool, input.bins, input.expectedActiveBin, input.deadline],
  };
}

export function buildDecreaseRangePosition(input: Readonly<{
  manager: Address;
  rangePositionId: bigint;
  shareBps: number;
  minimumAmount0: bigint;
  minimumAmount1: bigint;
  recipient: Address;
  deadline: bigint;
}>): PreparedContractCall {
  if (!Number.isInteger(input.shareBps) || input.shareBps < 1 || input.shareBps > 10_000)
    throw new Error("INVALID_RANGE_SHARE_BPS");
  return {
    address: input.manager,
    abi: rangePositionManagerAbi,
    functionName: "decreaseRangePosition",
    args: [
      input.rangePositionId,
      input.shareBps,
      input.minimumAmount0,
      input.minimumAmount1,
      input.recipient,
      input.deadline,
    ],
  };
}

export function validateRangeBins(bins: readonly RangeLiquidityBin[]): void {
  if (!bins.length || bins.length > 61) throw new Error("INVALID_RANGE_BIN_COUNT");
  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index]!;
    if (!Number.isInteger(bin.binId) || bin.binId < -10_000 || bin.binId > 10_000)
      throw new Error("INVALID_RANGE_BIN");
    if (index && bins[index - 1]!.binId >= bin.binId)
      throw new Error("RANGE_BINS_NOT_STRICTLY_ORDERED");
    if (bin.amount0 === 0n && bin.amount1 === 0n)
      throw new Error("ZERO_RANGE_BIN_AMOUNT");
  }
}

export type RangeOperationId = Hex;
