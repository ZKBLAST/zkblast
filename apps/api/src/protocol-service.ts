export type PageQuery = Readonly<{
  limit: number;
  cursor?: string | undefined;
  owner?: string | undefined;
}>;
export type PoolChartQuery = Readonly<{ from: Date; to: Date; limit: number }>;
export type PoolCandleQuery = PoolChartQuery & Readonly<{
  intervalSeconds: 60 | 300 | 900 | 3600 | 14400 | 86400;
}>;

export interface ProtocolReadStore {
  priceHistory?(
    pool: string,
    query: PoolChartQuery,
  ): Promise<readonly unknown[]>;
  poolCandles?(pool: string, query: PoolCandleQuery): Promise<readonly unknown[]>;
  poolStats?(pool: string): Promise<unknown>;
  poolTrades?(pool: string, query: PageQuery): Promise<readonly unknown[]>;
  pools(query: PageQuery): Promise<readonly unknown[]>;
  swaps(query: PageQuery): Promise<readonly unknown[]>;
  activity(query: PageQuery): Promise<readonly unknown[]>;
  positions(query: PageQuery): Promise<readonly unknown[]>;
  indexerStatus(): Promise<Readonly<{
    indexedBlock: bigint;
    finalizedBlock: bigint;
    updatedAt: Date;
  }> | null>;
  recentFailedTransactions(): Promise<number>;
}

export class ProtocolService {
  constructor(
    private readonly store: ProtocolReadStore,
    private readonly rpcHead: () => Promise<bigint>,
  ) {}

  pools(query: PageQuery) {
    return this.store.pools(query);
  }
  priceHistory(pool: string, query: PoolChartQuery) {
    if (!this.store.priceHistory) throw new Error("POOL_CHART_NOT_AVAILABLE");
    return this.store.priceHistory(pool.toLowerCase(), query);
  }
  poolCandles(pool: string, query: PoolCandleQuery) {
    if (!this.store.poolCandles) throw new Error("POOL_CANDLES_NOT_AVAILABLE");
    return this.store.poolCandles(pool.toLowerCase(), query);
  }
  poolStats(pool: string) {
    if (!this.store.poolStats) throw new Error("POOL_STATS_NOT_AVAILABLE");
    return this.store.poolStats(pool.toLowerCase());
  }
  poolTrades(pool: string, query: PageQuery) {
    if (!this.store.poolTrades) throw new Error("POOL_TRADES_NOT_AVAILABLE");
    return this.store.poolTrades(pool.toLowerCase(), query);
  }
  swaps(query: PageQuery) {
    return this.store.swaps(query);
  }
  activity(query: PageQuery) {
    return this.store.activity(query);
  }
  positions(query: PageQuery) {
    return this.store.positions(query);
  }

  async readiness() {
    const status = await this.store.indexerStatus();
    let rpcHead: bigint;
    try {
      rpcHead = await this.rpcHead();
    } catch {
      return {
        ready: false,
        rpcAvailable: false,
        rpcHead: status?.indexedBlock.toString() ?? "0",
        indexedBlock: status?.indexedBlock.toString() ?? null,
        ...(status
          ? {
              finalizedBlock: status.finalizedBlock.toString(),
              checkpointUpdatedAt: status.updatedAt.toISOString(),
            }
          : {}),
        lag: null,
      };
    }
    if (!status)
      return {
        ready: false,
        rpcAvailable: true,
        rpcHead: rpcHead.toString(),
        indexedBlock: null,
        lag: null,
      };
    const lag =
      rpcHead > status.indexedBlock ? rpcHead - status.indexedBlock : 0n;
    return {
      ready: lag <= 25n,
      rpcAvailable: true,
      rpcHead: rpcHead.toString(),
      indexedBlock: status.indexedBlock.toString(),
      finalizedBlock: status.finalizedBlock.toString(),
      lag: lag.toString(),
      checkpointUpdatedAt: status.updatedAt.toISOString(),
    };
  }

  recentFailedTransactions() {
    return this.store.recentFailedTransactions();
  }
}
