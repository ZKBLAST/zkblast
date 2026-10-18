export type PageQuery = Readonly<{
  limit: number;
  cursor?: string | undefined;
  owner?: string | undefined;
}>;

export interface ProtocolReadStore {
  pools(query: PageQuery): Promise<readonly unknown[]>;
  swaps(query: PageQuery): Promise<readonly unknown[]>;
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
  swaps(query: PageQuery) {
    return this.store.swaps(query);
  }
  positions(query: PageQuery) {
    return this.store.positions(query);
  }

  async readiness() {
    const [status, rpcHead] = await Promise.all([
      this.store.indexerStatus(),
      this.rpcHead(),
    ]);
    if (!status)
      return {
        ready: false,
        rpcHead: rpcHead.toString(),
        indexedBlock: null,
        lag: null,
      };
    const lag =
      rpcHead > status.indexedBlock ? rpcHead - status.indexedBlock : 0n;
    return {
      ready: lag <= 25n,
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
