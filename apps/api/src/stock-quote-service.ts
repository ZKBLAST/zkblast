export type StockQuoteAssetQuery = Readonly<{
  limit: number;
  availability?: "listed" | "eligible" | "verified" | "discovered" | "suspended" | "disabled";
  quoteTradingEnabled?: boolean;
}>;

export type StockQuoteReceiptQuery = Readonly<{
  limit: number;
  launchId?: string;
  quoteAssetAddress?: string;
}>;

export interface StockQuoteService {
  assets(query: StockQuoteAssetQuery): Promise<readonly Readonly<Record<string, unknown>>[]>;
  asset(contractAddress: string): Promise<Readonly<Record<string, unknown>> | null>;
  destinationCapabilities(
    contractAddress: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  launchPolicyBindings(
    query: StockQuoteReceiptQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  executionReceipts(
    query: StockQuoteReceiptQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}
