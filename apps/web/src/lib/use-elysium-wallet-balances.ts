"use client";

import {
  ELYSIUM_TESTNET_CHAIN_ID,
  elysiumCanonicalAssets,
} from "@zkblast/config";
import { erc20Abi, decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import { useEffect, useState } from "react";

export type ElysiumWalletBalances = Readonly<{
  nativeHype: bigint;
  whype: bigint;
  usdc: bigint;
}>;

const whype = elysiumCanonicalAssets.find((asset) => asset.symbol === "WHYPE")!;
const usdc = elysiumCanonicalAssets.find((asset) => asset.symbol === "USDC")!;

export function useElysiumWalletBalances(
  address: string | null,
  walletChainId: number | null,
): ElysiumWalletBalances | null {
  const [balances, setBalances] = useState<ElysiumWalletBalances | null>(null);

  useEffect(() => {
    let active = true;
    const provider = window.ethereum;
    if (
      !provider ||
      !address ||
      walletChainId !== ELYSIUM_TESTNET_CHAIN_ID
    ) {
      setBalances(null);
      return;
    }

    const tokenBalance = async (token: Address) => {
      const result = await provider.request({
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
        data: result as Hex,
      });
    };

    void Promise.all([
      provider.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
      tokenBalance(whype.address),
      tokenBalance(usdc.address),
    ])
      .then(([native, whypeBalance, usdcBalance]) => {
        if (active && typeof native === "string") {
          setBalances({
            nativeHype: BigInt(native),
            whype: whypeBalance,
            usdc: usdcBalance,
          });
        }
      })
      .catch(() => {
        if (active) setBalances(null);
      });

    return () => {
      active = false;
    };
  }, [address, walletChainId]);

  return balances;
}
