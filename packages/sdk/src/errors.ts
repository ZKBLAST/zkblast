export type SdkErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DECIMALS"
  | "INVALID_SLIPPAGE"
  | "INVALID_DEADLINE"
  | "INVALID_QUOTE"
  | "INVALID_CHAIN"
  | "WALLET_REQUIRED"
  | "UNSUPPORTED_CAPABILITY"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_ALLOWANCE"
  | "INVALID_LIFECYCLE"
  | "STALE_QUOTE"
  | "DBC_NOT_DEPLOYED"
  | "LAUNCHPAD_NOT_DEPLOYED"
  | "ASSISTANCE_FUND_NOT_DEPLOYED"
  | "ASSISTANCE_ROUTE_DISABLED"
  | "ASSISTANCE_ORACLE_STALE"
  | "ASSISTANCE_EXECUTION_LIMIT"
  | "LAUNCHPAD_PRESET_INVALID"
  | "LAUNCHPAD_FEE_POLICY_INVALID"
  | "LAUNCHPAD_PROOF_CONTEXT_INVALID"
  | "LAUNCHPAD_PROOF_INVALID"
  | "LAUNCHPAD_COMMITMENT_INVALID"
  | "INVALID_LIMIT"
  | "INVALID_API_CONFIG"
  | "LAUNCHPAD_API_REQUEST_FAILED"
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
