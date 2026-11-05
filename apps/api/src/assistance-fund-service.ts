export type AssistancePageQuery = Readonly<{
  limit: number;
  cursor?: string;
  asset?: string;
  sourceId?: string;
}>;

export interface AssistanceFundService {
  summary(asset?: string): Promise<Readonly<Record<string, unknown>>>;
  revenue(
    query: AssistancePageQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  buybacks(
    query: AssistancePageQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  burns(
    query: AssistancePageQuery,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}
