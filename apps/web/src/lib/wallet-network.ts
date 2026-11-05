import type { ChainCatalogItem, EthereumProvider } from "@/types/application";
import { getChainDescriptor } from "@zkblast/config";

function providerErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

export async function ensureWalletChain(
  provider: EthereumProvider,
  chain: Pick<ChainCatalogItem, "chainId" | "name" | "nativeCurrency" | "explorerUrl">,
): Promise<void> {
  const descriptor = getChainDescriptor(chain.chainId);
  const chainId = `0x${chain.chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4_902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...descriptor.publicRpcUrls],
          blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : [],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }

  const selected = await provider.request({ method: "eth_chainId" });
  if (typeof selected !== "string" || Number.parseInt(selected, 16) !== chain.chainId) {
    throw new Error("WALLET_CHAIN_MISMATCH");
  }
}
