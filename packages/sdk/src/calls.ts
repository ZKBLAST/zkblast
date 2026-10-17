import {
  dammPoolAbi,
  dlmmPoolAbi,
  erc20Abi,
  positionManagerAbi,
  swapRouterAbi,
} from "@zkblast/abi";
import type { Abi, Address } from "viem";

export type PreparedContractCall = Readonly<{
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}>;

type BaseSwap = Readonly<{
  router: Address;
  pool: Address;
  amountIn: bigint;
  minimumAmountOut: bigint;
  recipient: Address;
  deadline: bigint;
}>;

export function buildApproval(
  token: Address,
  spender: Address,
  amount: bigint,
): PreparedContractCall {
  return {
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  };
}

export function buildDammSwap(
  input: BaseSwap & { tokenIn: Address },
): PreparedContractCall {
  return {
    address: input.router,
    abi: swapRouterAbi,
    functionName: "swapDammExactInput",
    args: [
      input.pool,
      input.tokenIn,
      input.amountIn,
      input.minimumAmountOut,
      input.recipient,
      input.deadline,
    ],
  };
}

export function buildDlmmSwap(
  input: BaseSwap & { token0ToToken1: boolean; maximumBinCrossings: number },
): PreparedContractCall {
  return {
    address: input.router,
    abi: swapRouterAbi,
    functionName: "swapDlmmExactInput",
    args: [
      input.pool,
      input.token0ToToken1,
      input.amountIn,
      input.minimumAmountOut,
      input.maximumBinCrossings,
      input.recipient,
      input.deadline,
    ],
  };
}

type PositionInput = Readonly<{
  manager: Address;
  pool: Address;
  amount0: bigint;
  amount1: bigint;
  minimumShares: bigint;
  deadline: bigint;
}>;

export function buildCreateDammPosition(
  input: PositionInput,
): PreparedContractCall {
  return {
    address: input.manager,
    abi: positionManagerAbi,
    functionName: "createDammPosition",
    args: [
      input.pool,
      input.amount0,
      input.amount1,
      input.minimumShares,
      input.deadline,
    ],
  };
}

export function buildCreateDlmmPosition(
  input: PositionInput & { binId: number },
): PreparedContractCall {
  return {
    address: input.manager,
    abi: positionManagerAbi,
    functionName: "createDlmmPosition",
    args: [
      input.pool,
      input.binId,
      input.amount0,
      input.amount1,
      input.minimumShares,
      input.deadline,
    ],
  };
}

export function buildIncreasePosition(
  manager: Address,
  positionId: bigint,
  amount0: bigint,
  amount1: bigint,
  minimumShares: bigint,
  deadline: bigint,
): PreparedContractCall {
  return {
    address: manager,
    abi: positionManagerAbi,
    functionName: "increasePosition",
    args: [positionId, amount0, amount1, minimumShares, deadline],
  };
}

export function buildDecreasePosition(
  manager: Address,
  positionId: bigint,
  shares: bigint,
  minimumAmount0: bigint,
  minimumAmount1: bigint,
  recipient: Address,
  deadline: bigint,
): PreparedContractCall {
  return {
    address: manager,
    abi: positionManagerAbi,
    functionName: "decreasePosition",
    args: [
      positionId,
      shares,
      minimumAmount0,
      minimumAmount1,
      recipient,
      deadline,
    ],
  };
}

export function buildTransferPosition(
  manager: Address,
  positionId: bigint,
  nextOwner: Address,
): PreparedContractCall {
  return {
    address: manager,
    abi: positionManagerAbi,
    functionName: "transferPosition",
    args: [positionId, nextOwner],
  };
}

export function buildDammFeeClaim(pool: Address): PreparedContractCall {
  return {
    address: pool,
    abi: dammPoolAbi,
    functionName: "collectProtocolFees",
    args: [],
  };
}

export function buildDlmmFeeClaim(pool: Address): PreparedContractCall {
  return {
    address: pool,
    abi: dlmmPoolAbi,
    functionName: "collectProtocolFees",
    args: [],
  };
}
