import { poolQuoterAbi } from "@zkblast/abi";
import type { Address } from "viem";

import { SdkError } from "./errors.js";

export interface ContractReader {
  readContract(request: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export type DammQuote = Readonly<{ amountOut: bigint; feeAmount: bigint }>;
export type DlmmQuote = Readonly<{
  amountOut: bigint;
  finalBin: number;
  binsCrossed: number;
}>;

export async function quoteDammExactInput(
  client: ContractReader,
  quoter: Address,
  pool: Address,
  tokenIn: Address,
  amountIn: bigint,
): Promise<DammQuote> {
  const result = await client.readContract({
    address: quoter,
    abi: poolQuoterAbi,
    functionName: "quoteDammExactInput",
    args: [pool, tokenIn, amountIn],
  });
  if (
    !Array.isArray(result) ||
    typeof result[0] !== "bigint" ||
    typeof result[1] !== "bigint"
  ) {
    throw new SdkError(
      "INVALID_QUOTE",
      "DAMM quoter returned an invalid result",
    );
  }
  return { amountOut: result[0], feeAmount: result[1] };
}

export async function quoteDlmmExactInput(
  client: ContractReader,
  quoter: Address,
  pool: Address,
  token0ToToken1: boolean,
  amountIn: bigint,
  maximumBinCrossings: number,
): Promise<DlmmQuote> {
  const result = await client.readContract({
    address: quoter,
    abi: poolQuoterAbi,
    functionName: "quoteDlmmExactInput",
    args: [pool, token0ToToken1, amountIn, maximumBinCrossings],
  });
  if (
    !Array.isArray(result) ||
    typeof result[0] !== "bigint" ||
    typeof result[1] !== "number" ||
    typeof result[2] !== "number"
  ) {
    throw new SdkError(
      "INVALID_QUOTE",
      "DLMM quoter returned an invalid result",
    );
  }
  return { amountOut: result[0], finalBin: result[1], binsCrossed: result[2] };
}
