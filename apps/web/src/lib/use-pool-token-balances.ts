"use client";
import { useEffect, useState } from "react";
import {
  erc20Abi,
  encodeFunctionData,
  decodeFunctionResult,
  type Address,
  type Hex,
} from "viem";
import type { ProtocolExecutionPool } from "@/types/application";

export function usePoolTokenBalances(
  pool: ProtocolExecutionPool | undefined,
  address: string | null | undefined,
  chainId: number | undefined,
  revision: number,
) {
  const key = `${pool?.address}:${address}:${chainId}:${revision}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    values: readonly [bigint, bigint];
  } | null>(null);
  useEffect(() => {
    let active = true;
    const provider = window.ethereum;
    if (!provider || !pool || !address || !chainId) return;
    async function read() {
      if (
        Number(await provider!.request({ method: "eth_chainId" })) !== chainId
      )
        return;
      const balances = await Promise.all(
        [pool!.token0Address, pool!.token1Address].map(async (token) => {
          const data = await provider!.request({
            method: "eth_call",
            params: [
              {
                to: token,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [address as Address],
                }),
              },
              "latest",
            ],
          });
          return decodeFunctionResult({
            abi: erc20Abi,
            functionName: "balanceOf",
            data: data as Hex,
          });
        }),
      );
      if (active) setSnapshot({ key, values: balances as [bigint, bigint] });
    }
    void read().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [key, pool, address, chainId]);
  return snapshot?.key === key ? snapshot.values : null;
}
