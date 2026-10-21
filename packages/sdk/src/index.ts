export type TransactionStatus =
  "idle" | "signing" | "submitted" | "confirmed" | "failed";

export function explorerTransactionUrl(
  explorerUrl: string,
  transactionHash: string,
): string {
  return `${explorerUrl.replace(/\/$/u, "")}/tx/${transactionHash}`;
}

export * from "./adapters.js";
export * from "./amounts.js";
export * from "./calls.js";
export * from "./deployments.js";
export * from "./errors.js";
export * from "./quotes.js";
export * from "./pool-creation.js";
export * from "./shielded-batch-poc.js";
export * from "./shielded-v2-terms.js";
export * from "./shielded-v2-accounting.js";
export * from "./shielded-v2-note.js";
export * from "./shielded-v2-statement.js";
export * from "./shielded-v2-funds.js";
