export type TransactionStatus =
  "idle" | "signing" | "submitted" | "confirmed" | "failed";

export function explorerTransactionUrl(
  explorerUrl: string,
  transactionHash: string,
): string {
  return `${explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`;
}
