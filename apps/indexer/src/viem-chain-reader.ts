import { protocolAbis } from "@zkblast/abi";
import {
  decodeEventLog,
  zeroAddress,
  type Address,
  type PublicClient,
  type Log,
} from "viem";
import { classifyProtocolEvent } from "./classifier.js";
import type { BlockEnvelope, IndexedEvent } from "./domain.js";
import type { ChainReader } from "./indexer-service.js";

const combinedAbi = Object.values(protocolAbis).flat();

function serializeArgs(
  args: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!args || typeof args !== "object") return {};
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === "bigint") return [key, value.toString()];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      )
        return [key, value];
      return [
        key,
        JSON.stringify(value, (_nestedKey, nestedValue: unknown) =>
          typeof nestedValue === "bigint"
            ? nestedValue.toString()
            : nestedValue,
        ),
      ];
    }),
  );
}

export class ViemChainReader implements ChainReader {
  private readonly trackedAddresses: Set<Address>;
  constructor(
    private readonly client: PublicClient,
    private readonly chainId: number,
    addresses: readonly Address[],
  ) {
    this.trackedAddresses = new Set(addresses);
  }
  head(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async block(
    blockNumber: bigint,
    suppliedLogs?: readonly Log[],
  ): Promise<BlockEnvelope> {
    const [block, logs] = await Promise.all([
      this.client.getBlock({ blockNumber }),
      suppliedLogs ??
        this.client.getLogs({
          address: [...this.trackedAddresses],
          fromBlock: blockNumber,
          toBlock: blockNumber,
        }),
    ]);
    const events: IndexedEvent[] = [];
    this.decodeLogs(logs, blockNumber, block.timestamp, events);
    if (!suppliedLogs) {
      const discovered = events
        .filter((event) => event.eventName === "TokenLaunched")
        .flatMap((event) => [
          event.payload.token,
          event.payload.virtualPool,
        ])
        .filter(
          (token): token is Address =>
            typeof token === "string" && /^0x[\da-f]{40}$/iu.test(token),
        )
        .filter((token) => !this.trackedAddresses.has(token));
      if (discovered.length) {
        discovered.forEach((token) => this.trackedAddresses.add(token));
        const tokenLogs = await this.client.getLogs({
          address: discovered,
          fromBlock: blockNumber,
          toBlock: blockNumber,
        });
        // Keep the factory events first. Token mint/transfer logs can precede
        // TokenLaunched onchain, but the projection needs the launch row and
        // token allowlist before it can account holder balances safely.
        this.decodeLogs(tokenLogs, blockNumber, block.timestamp, events);
      }
    }
    const transactionHashes = [
      ...new Set(events.map((event) => event.transactionHash)),
    ];
    const receipts = await Promise.all(
      transactionHashes.map((hash) =>
        this.client.getTransactionReceipt({ hash }),
      ),
    );
    receipts.forEach((receipt, index) => {
      if (
        receipt.blockNumber !== blockNumber ||
        receipt.blockHash !== block.hash
      )
        throw new Error("RECEIPT_BLOCK_MISMATCH");
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.transactionHash === receipt.transactionHash)
          events[i] = {
            ...event,
            payload: {
              ...event.payload,
              transactionSender: receipt.from.toLowerCase(),
            },
          };
      }
      events.push({
        chainId: this.chainId,
        blockNumber,
        blockHash: receipt.blockHash,
        transactionHash: receipt.transactionHash,
        logIndex: 1_000_000 + index,
        contractAddress: receipt.to ?? receipt.contractAddress ?? zeroAddress,
        kind: "receipt",
        eventName: "TransactionReceipt",
        payload: {
          status: receipt.status,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        },
      });
    });
    return {
      number: blockNumber,
      hash: block.hash,
      parentHash: block.parentHash,
      events,
    };
  }

  private decodeLogs(
    logs: readonly Log[],
    blockNumber: bigint,
    blockTimestamp: bigint,
    events: IndexedEvent[],
  ): void {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: combinedAbi,
          data: log.data,
          topics: log.topics,
        });
        const kind = classifyProtocolEvent(decoded.eventName);
        if (
          !kind ||
          log.logIndex === null ||
          log.transactionHash === null ||
          log.blockHash === null
        )
          continue;
        events.push({
          chainId: this.chainId,
          blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          contractAddress: log.address,
          kind,
          eventName: decoded.eventName,
          payload: {
            ...serializeArgs(decoded.args),
            blockTimestamp: blockTimestamp.toString(),
          },
        });
      } catch {
        /* Unknown logs are outside the protocol surface. */
      }
    }
  }
}
