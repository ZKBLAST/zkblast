import type { BlockEnvelope, IndexerCheckpoint } from "./domain.js";
import type { IndexerRepository } from "./repository.js";
import { validateBlockForPersistence } from "./validation.js";

export interface ChainReader {
  head(): Promise<bigint>;
  block(blockNumber: bigint): Promise<BlockEnvelope>;
}

export class IndexerService {
  constructor(
    private readonly chainId: number,
    private readonly confirmations: bigint,
    private readonly reader: ChainReader,
    private readonly repository: IndexerRepository,
  ) {
    if (confirmations < 0n) throw new Error("INVALID_FINALITY_POLICY");
  }

  async sync(
    fromBlock: bigint,
    maximumBlocks = 100n,
  ): Promise<IndexerCheckpoint | null> {
    if (maximumBlocks <= 0n) throw new Error("INVALID_BATCH_SIZE");
    const head = await this.reader.head();
    if (head < this.confirmations)
      return this.repository.checkpoint(this.chainId);
    const finalizedBlock = head - this.confirmations;
    let checkpoint = await this.repository.checkpoint(this.chainId);
    let nextBlock = checkpoint ? checkpoint.blockNumber + 1n : fromBlock;
    if (checkpoint && nextBlock <= finalizedBlock) {
      const next = await this.reader.block(nextBlock);
      if (
        next.parentHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()
      ) {
        checkpoint = await this.findCommonAncestor(checkpoint);
        nextBlock = checkpoint ? checkpoint.blockNumber + 1n : fromBlock;
      }
    }
    const batchEnd =
      nextBlock + maximumBlocks - 1n < finalizedBlock
        ? nextBlock + maximumBlocks - 1n
        : finalizedBlock;
    for (; nextBlock <= batchEnd; nextBlock += 1n) {
      const block = validateBlockForPersistence(
        await this.reader.block(nextBlock),
        this.chainId,
      );
      const nextCheckpoint = {
        chainId: this.chainId,
        blockNumber: block.number,
        blockHash: block.hash,
        finalizedBlock: block.number,
      };
      await this.repository.applyBlock(block, nextCheckpoint);
      checkpoint = nextCheckpoint;
    }
    return checkpoint;
  }

  private async findCommonAncestor(
    checkpoint: IndexerCheckpoint,
  ): Promise<IndexerCheckpoint | null> {
    let cursor = checkpoint.blockNumber;
    while (cursor >= 0n) {
      const [storedHash, chainBlock] = await Promise.all([
        this.repository.canonicalHash(this.chainId, cursor),
        this.reader.block(cursor),
      ]);
      if (storedHash?.toLowerCase() === chainBlock.hash.toLowerCase()) {
        await this.repository.rewind(this.chainId, cursor + 1n);
        return this.repository.checkpoint(this.chainId);
      }
      if (cursor === 0n) break;
      if (this.repository.previousCanonicalBlock) {
        const previous = await this.repository.previousCanonicalBlock(
          this.chainId,
          cursor,
        );
        if (previous === null) break;
        cursor = previous;
      } else cursor -= 1n;
    }
    await this.repository.rewind(this.chainId, 0n);
    return null;
  }
}
