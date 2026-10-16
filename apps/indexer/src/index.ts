export type IndexerCheckpoint = Readonly<{
  chainId: number;
  blockNumber: bigint;
}>;

export function checkpointKey(checkpoint: IndexerCheckpoint): string {
  return `${checkpoint.chainId}:${checkpoint.blockNumber}`;
}
