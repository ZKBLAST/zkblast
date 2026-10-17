import type { EthereumProvider } from "../types/application";

export type PreparedTransaction = Readonly<{
  to: string;
  data: string;
  value: string;
}>;
export type SwapExecutionState =
  "switching-network" | "approving" | "swapping" | "confirmed";
export type TransactionExecutionState =
  "switching-network" | "submitting" | "confirmed";

export async function waitForReceipt(
  provider: EthereumProvider,
  hash: string,
  attempts = 40,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { transactionHash: string; status: string } | null;
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("TRANSACTION_REVERTED");
      return receipt;
    }
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("TRANSACTION_PENDING_OR_REPLACED");
}

export async function executeSwap(
  provider: EthereumProvider,
  account: string,
  chainId: number,
  approval: PreparedTransaction,
  swap: PreparedTransaction,
  onState: (state: SwapExecutionState, hash?: string) => void,
) {
  const currentChain = Number.parseInt(
    (await provider.request({ method: "eth_chainId" })) as string,
    16,
  );
  if (currentChain !== chainId) {
    onState("switching-network");
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  }
  onState("approving");
  const approvalHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ ...approval, from: account }],
  })) as string;
  await waitForReceipt(provider, approvalHash);
  onState("swapping");
  const swapHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ ...swap, from: account }],
  })) as string;
  await waitForReceipt(provider, swapHash);
  onState("confirmed", swapHash);
  return swapHash;
}

export async function executeTransactions(
  provider: EthereumProvider,
  account: string,
  chainId: number,
  transactions: readonly PreparedTransaction[],
  onState: (state: TransactionExecutionState, hash?: string) => void,
) {
  const currentChain = Number.parseInt(
    (await provider.request({ method: "eth_chainId" })) as string,
    16,
  );
  if (currentChain !== chainId) {
    onState("switching-network");
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  }
  let finalHash = "";
  for (const transaction of transactions) {
    onState("submitting");
    finalHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...transaction, from: account }],
    })) as string;
    await waitForReceipt(provider, finalHash);
  }
  onState("confirmed", finalHash);
  return finalHash;
}

export function swapErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rejected|denied/iu.test(message))
    return "Signature rejected. No transaction was submitted.";
  if (/pending|replaced/iu.test(message))
    return "Transaction is pending or replaced. Check the explorer, then retry status.";
  if (/revert/iu.test(message))
    return "Transaction reverted. Refresh the quote before retrying.";
  return "Swap could not be completed. Refresh the quote and try again.";
}
