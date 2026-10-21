import { dammPoolAbi, dlmmPoolAbi, poolQuoterAbi } from "@zkblast/abi";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type {
  EthereumProvider,
  ProtocolExecutionPool,
} from "@/types/application";

export type PrivateAmountsV2 = readonly [bigint, bigint, bigint];
function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("INVALID_V2_LIQUIDITY");
  if (value < 2n) return value;
  let root = value,
    next = (value + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
}

/** Quotes use one pinned wallet RPC block and actual contract state, never market reference prices. */
export async function quotePrivateActionV2(
  provider: EthereumProvider,
  pool: ProtocolExecutionPool,
  action: "swap" | "add" | "remove",
  input: PrivateAmountsV2,
  binId: number,
  quoter?: Address,
) {
  const block = (await provider.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  })) as { number: Hex; timestamp: Hex };
  if (!block?.number || !block.timestamp)
    throw new Error("V2_BLOCK_UNAVAILABLE");
  const call = async (to: Address, data: Hex): Promise<Hex> =>
    (await provider.request({
      method: "eth_call",
      params: [{ to, data }, block.number],
    })) as Hex;
  const address = pool.address as Address;
  const token0 = await call(
    address,
    encodeFunctionData({ abi: dammPoolAbi, functionName: "token0" }),
  );
  const token1 = await call(
    address,
    encodeFunctionData({ abi: dammPoolAbi, functionName: "token1" }),
  );
  if (
    decodeFunctionResult({
      abi: dammPoolAbi,
      functionName: "token0",
      data: token0,
    }).toLowerCase() !== pool.token0Address.toLowerCase() ||
    decodeFunctionResult({
      abi: dammPoolAbi,
      functionName: "token1",
      data: token1,
    }).toLowerCase() !== pool.token1Address.toLowerCase()
  )
    throw new Error("V2_POOL_TOKEN_MISMATCH");
  const inflows: [bigint, bigint, bigint] = [0n, 0n, 0n];
  const outflows: [bigint, bigint, bigint] = [...input];
  if (action === "swap") {
    if (!quoter || input[2] !== 0n || input[0] > 0n === input[1] > 0n)
      throw new Error("INVALID_V2_SWAP_INPUT");
    const zeroForOne = input[0] > 0n;
    const amount = zeroForOne ? input[0] : input[1];
    const functionName =
      pool.model === "damm" ? "quoteDammExactInput" : "quoteDlmmExactInput";
    const data =
      pool.model === "damm"
        ? encodeFunctionData({
            abi: poolQuoterAbi,
            functionName: "quoteDammExactInput",
            args: [
              address,
              (zeroForOne ? pool.token0Address : pool.token1Address) as Address,
              amount,
            ],
          })
        : encodeFunctionData({
            abi: poolQuoterAbi,
            functionName: "quoteDlmmExactInput",
            args: [address, zeroForOne, amount, 32],
          });
    const result = decodeFunctionResult({
      abi: poolQuoterAbi,
      functionName,
      data: await call(quoter, data),
    });
    inflows[zeroForOne ? 1 : 0] = result[0];
  } else {
    let reserve0: bigint, reserve1: bigint, total: bigint, minimum: bigint;
    if (pool.model === "dlmm") {
      const data = await call(
        address,
        encodeFunctionData({
          abi: dlmmPoolAbi,
          functionName: "binState",
          args: [binId],
        }),
      );
      [reserve0, reserve1, total] = decodeFunctionResult({
        abi: dlmmPoolAbi,
        functionName: "binState",
        data,
      });
      minimum = decodeFunctionResult({
        abi: dlmmPoolAbi,
        functionName: "MINIMUM_BIN_LIQUIDITY",
        data: await call(
          address,
          encodeFunctionData({
            abi: dlmmPoolAbi,
            functionName: "MINIMUM_BIN_LIQUIDITY",
          }),
        ),
      });
    } else {
      const read = async (
        name: "reserve0" | "reserve1" | "totalShares" | "MINIMUM_LIQUIDITY",
      ) =>
        decodeFunctionResult({
          abi: dammPoolAbi,
          functionName: name,
          data: await call(
            address,
            encodeFunctionData({ abi: dammPoolAbi, functionName: name }),
          ),
        });
      [reserve0, reserve1, total, minimum] = await Promise.all([
        read("reserve0"),
        read("reserve1"),
        read("totalShares"),
        read("MINIMUM_LIQUIDITY"),
      ]);
    }
    if (action === "add") {
      if (input[0] <= 0n || input[1] <= 0n || input[2] !== 0n)
        throw new Error("V2_TWO_SIDED_LIQUIDITY_REQUIRED");
      inflows[2] =
        total === 0n
          ? sqrt(input[0] * input[1]) - minimum
          : (input[0] * total) / reserve0 < (input[1] * total) / reserve1
            ? (input[0] * total) / reserve0
            : (input[1] * total) / reserve1;
    } else {
      if (total <= 0n || input[2] <= 0n || input[0] !== 0n || input[1] !== 0n)
        throw new Error("INVALID_V2_LP_INPUT");
      inflows[0] = (input[2] * reserve0) / total;
      inflows[1] = (input[2] * reserve1) / total;
    }
  }
  if (
    !inflows.some((value) => value > 0n) ||
    inflows.some((value) => value < 0n || value >= 2n ** 128n)
  )
    throw new Error("V2_INSUFFICIENT_LIQUIDITY");
  return {
    inflows,
    outflows,
    deadline: BigInt(block.timestamp) + 900n,
    crossings: 32,
  };
}
