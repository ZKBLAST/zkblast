export type SdkErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DECIMALS"
  | "INVALID_SLIPPAGE"
  | "INVALID_DEADLINE"
  | "INVALID_QUOTE"
  | "INVALID_CHAIN"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_ALLOWANCE"
  | "INVALID_LIFECYCLE"
  | "STALE_QUOTE"
  | "DBC_NOT_DEPLOYED"
  | "INVALID_ADAPTER"
  | "USER_REJECTED"
  | "CONTRACT_REVERTED"
  | "RPC_ERROR"
  | "UNKNOWN";

export class SdkError extends Error {
  readonly code: SdkErrorCode;
  override readonly cause?: unknown;

  constructor(code: SdkErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.cause = cause;
  }
}

export function normalizeTransactionError(error: unknown): SdkError {
  if (error instanceof SdkError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("user rejected") ||
    normalized.includes("user denied")
  ) {
    return new SdkError(
      "USER_REJECTED",
      "Transaction was rejected by the user",
      error,
    );
  }
  if (normalized.includes("revert")) {
    return new SdkError("CONTRACT_REVERTED", message, error);
  }
  if (normalized.includes("rpc") || normalized.includes("network")) {
    return new SdkError("RPC_ERROR", message, error);
  }
  return new SdkError("UNKNOWN", message, error);
}
