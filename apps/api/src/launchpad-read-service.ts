type Row = Record<string, unknown>;
interface LaunchpadReadStore {
  freshness(): Promise<{ indexedBlock: string; finalizedBlock: string; lagBlocks: string; indexedAt: string } | null>;
  list(input: { limit: number; cursor?: string }): Promise<readonly Row[]>;
  detail(id: string): Promise<Row | null>;
  tokens(id: string,limit: number): Promise<readonly Row[]>;
  trades(id: string,limit: number): Promise<readonly Row[]>;
  fees(id: string): Promise<unknown>;
  graduations(id: string,limit: number): Promise<readonly Row[]>;
  boundPool(id: string,pool: string): Promise<{ virtual_pool: string; template_id: string; lifecycle: number } | null>;
  health(): Promise<Record<string,string>>;
  events(afterBlock: string,afterLogIndex: number,limit: number): Promise<readonly Row[]>;
}
interface LaunchpadQuoteReader { quote(pool: `0x${string}`,side: "buy"|"sell",amountRaw: bigint): Promise<unknown>; }

export class LaunchpadReadService {
  constructor(
    private readonly environment: "testnet" | "mainnet",
    private readonly chainId: number,
    private readonly store: LaunchpadReadStore,
    private readonly quoteReader?: LaunchpadQuoteReader,
    private readonly rpcHead?: () => Promise<bigint>,
  ) {}

  private async envelope<T>(data: T) {
    return { environment: this.environment, chainId: this.chainId, freshness: await this.store.freshness(), data };
  }

  async list(limit: number, cursor?: string) {
    const rows = await this.store.list(cursor ? { limit, cursor } : { limit });
    const items = rows.slice(0,limit);
    const tail = items.at(-1) as { updated_block?: string; launchpad_id?: string } | undefined;
    return this.envelope({ items, nextCursor: rows.length > limit && tail ? `${tail.updated_block}:${tail.launchpad_id}` : null });
  }
  async detail(id: string) {
    const item = await this.store.detail(id);
    if (!item) throw new Error("LAUNCHPAD_NOT_FOUND");
    return this.envelope(item);
  }
  async tokens(id: string, limit: number) { return this.envelope(await this.store.tokens(id,limit)); }
  async trades(id: string, limit: number) { return this.envelope(await this.store.trades(id,limit)); }
  async fees(id: string) { return this.envelope(await this.store.fees(id)); }
  async graduations(id: string, limit: number) { return this.envelope(await this.store.graduations(id,limit)); }
  async quote(id: string,pool: `0x${string}`,side: "buy"|"sell",amountRaw: bigint) {
    if (!this.quoteReader) throw new Error("LAUNCHPAD_QUOTE_UNAVAILABLE");
    const binding = await this.store.boundPool(id,pool);
    if (!binding) throw new Error("LAUNCHPAD_POOL_NOT_BOUND");
    if (binding.lifecycle < 1 || binding.lifecycle > 2) throw new Error("LAUNCHPAD_POOL_NOT_TRADABLE");
    return this.envelope({ binding, quote: await this.quoteReader.quote(pool,side,amountRaw) });
  }
  async health() {
    const [freshness,counts,head] = await Promise.all([
      this.store.freshness(),this.store.health(),this.rpcHead?.() ?? Promise.resolve(null),
    ]);
    const issues = Number(counts.missing_launchpad_bindings) + Number(counts.incomplete_fee_snapshots);
    const indexedBlock = BigInt(freshness?.indexedBlock ?? "0");
    const rpcLag = head && head > indexedBlock ? head - indexedBlock : 0n;
    const lag = Number(rpcLag > BigInt(freshness?.lagBlocks ?? "0") ? rpcLag : BigInt(freshness?.lagBlocks ?? "0"));
    return {
      api: "ok", environment: this.environment, chainId: this.chainId,
      status: issues > 0 || Number(counts.webhook_dead_letters) > 0 ? "degraded" : lag > 25 ? "stale" : "healthy",
      freshness: { ...freshness, rpcHead: head?.toString() ?? null, rpcLagBlocks: rpcLag.toString() },
      counts,
      reconciliation: {
        launchBindings: Number(counts.missing_launchpad_bindings) === 0,
        feeSnapshots: Number(counts.incomplete_fee_snapshots) === 0,
      },
    };
  }
  async events(afterBlock: string,afterLogIndex: number,limit: number) {
    const items = await this.store.events(afterBlock,afterLogIndex,limit);
    const tail = items.at(-1) as { block_number?: string; log_index?: number } | undefined;
    return this.envelope({
      items,
      nextCursor: tail?.block_number !== undefined && tail.log_index !== undefined
        ? `${tail.block_number}:${tail.log_index}` : `${afterBlock}:${afterLogIndex}`,
    });
  }
}
