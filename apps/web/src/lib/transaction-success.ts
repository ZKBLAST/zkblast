export const transactionSuccessEvent = "zkblast:transaction-confirmed";

export type TransactionSuccess = Readonly<{
  hash: string;
  chainId: number;
  action: string;
  blockNumber?: string;
  gasUsed?: string;
}>;

export function notifyTransactionSuccess(transaction: TransactionSuccess) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(transactionSuccessEvent, { detail: transaction }),
  );
}
