import {
  eventIdentity,
  type BlockEnvelope,
  type IndexedEvent,
  type IndexerCheckpoint,
} from "./domain.js";
import {
  transactionObservation,
  type TransactionObservation,
} from "./transaction-reconciliation.js";

export interface IndexerRepository {
  checkpoint(chainId: number): Promise<IndexerCheckpoint | null>;
  canonicalHash(chainId: number, blockNumber: bigint): Promise<string | null>;
  applyBlock(
    block: BlockEnvelope,
    checkpoint: IndexerCheckpoint,
  ): Promise<void>;
  rewind(chainId: number, fromBlock: bigint): Promise<void>;
}

export class MemoryIndexerRepository implements IndexerRepository {
  readonly events = new Map<string, IndexedEvent>();
  readonly blocks = new Map<string, string>();
  readonly transactions = new Map<string, TransactionObservation>();
  private readonly checkpoints = new Map<number, IndexerCheckpoint>();

  checkpoint(chainId: number): Promise<IndexerCheckpoint | null> {
    return Promise.resolve(this.checkpoints.get(chainId) ?? null);
  }
  canonicalHash(chainId: number, blockNumber: bigint): Promise<string | null> {
    return Promise.resolve(
      this.blocks.get(`${chainId}:${blockNumber}`) ?? null,
    );
  }

  applyBlock(
    block: BlockEnvelope,
    checkpoint: IndexerCheckpoint,
  ): Promise<void> {
    this.blocks.set(`${checkpoint.chainId}:${block.number}`, block.hash);
    for (const event of block.events) {
      this.events.set(eventIdentity(event), event);
      const observation = transactionObservation(event);
      if (observation)
        this.transactions.set(
          `${observation.chainId}:${observation.transactionHash}`,
          observation,
        );
    }
    this.checkpoints.set(checkpoint.chainId, checkpoint);
    return Promise.resolve();
  }

  rewind(chainId: number, fromBlock: bigint): Promise<void> {
    for (const [key, event] of this.events)
      if (event.chainId === chainId && event.blockNumber >= fromBlock)
        this.events.delete(key);
    for (const key of this.blocks.keys()) {
      const [storedChain, storedBlock] = key.split(":");
      if (
        Number(storedChain) === chainId &&
        BigInt(storedBlock ?? "0") >= fromBlock
      )
        this.blocks.delete(key);
    }
    for (const [key, transaction] of this.transactions)
      if (
        transaction.chainId === chainId &&
        transaction.blockNumber >= fromBlock
      )
        this.transactions.delete(key);
    const previous = fromBlock - 1n;
    const hash = this.blocks.get(`${chainId}:${previous}`);
    const current = this.checkpoints.get(chainId);
    if (hash && current)
      this.checkpoints.set(chainId, {
        chainId,
        blockNumber: previous,
        blockHash: hash as `0x${string}`,
        finalizedBlock:
          current.finalizedBlock < previous ? current.finalizedBlock : previous,
      });
    else this.checkpoints.delete(chainId);
    return Promise.resolve();
  }
}
