export type StockQuoteAssetQuery = Readonly<{
  limit: number;
  availability?:
    | "listed"
    | "eligible"
    | "verified"
    | "discovered"
    | "suspended"
    | "disabled";
  quoteTradingEnabled?: boolean;
}>;

export type StockQuoteReceiptQuery = Readonly<{
  limit: number;
  launchId?: string;
  quoteAssetAddress?: string;
}>;

export type ValidatedStockQuoteObservation = Readonly<{
  priceX18: string;
  notionalX18: string;
  updatedAt: string;
  roundId: string;
  marketState:
    "active" | "after_hours" | "closed" | "halted" | "degraded" | "emergency";
  multiplierX18: string;
}>;

export interface StockQuoteService {
  assets(
    query: StockQuoteAssetQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  asset(
    contractAddress: string,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  destinationCapabilities(
    contractAddress: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  launches(
    contractAddress: string,
    limit: number,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  graduations(
    contractAddress: string,
    limit: number,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  launchPolicyBindings(
    query: StockQuoteReceiptQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  executionReceipts(
    query: StockQuoteReceiptQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  validatedUsdNotional?(
    contractAddress: string,
    operation: "create_launch" | "fund" | "buy" | "sell" | "graduate" | "exit",
    amountRaw: string,
  ): Promise<ValidatedStockQuoteObservation>;
}
