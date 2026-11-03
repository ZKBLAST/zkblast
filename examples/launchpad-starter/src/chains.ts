import { createZKBlastClient, type ChainIdReader } from "@zkblast/sdk";

export const exampleNetworks = {
  robinhoodMainnet: 4663,
  hyperEvmTestnet: 998,
  hyperEvmMainnet: 999,
} as const;

/**
 * The host application supplies its wallet/public client. No RPC URL or key is
 * embedded in this example.
 */
export function createExampleClient(
  chainId: (typeof exampleNetworks)[keyof typeof exampleNetworks],
  publicClient: ChainIdReader,
  walletClient?: ChainIdReader,
) {
  return createZKBlastClient({ chainId, publicClient, walletClient });
}

export function futureDeadline(secondsFromNow = 300): bigint {
  if (!Number.isSafeInteger(secondsFromNow) || secondsFromNow < 30) {
    throw new Error("DEADLINE_WINDOW_INVALID");
  }
  return BigInt(Math.floor(Date.now() / 1_000) + secondsFromNow);
}
