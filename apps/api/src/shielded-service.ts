import { zkBlastVaultAbi } from "@zkblast/abi";
import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const DEPTH = 32;
const EMPTY_LEAF = `0x${"0".repeat(63)}1` as Hex;
const hasherAbi = [
  {
    type: "function",
    name: "hashMerkleNode",
    stateMutability: "view",
    inputs: [
      { name: "level", type: "uint256" },
      { name: "left", type: "bytes32" },
      { name: "right", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

type Config = Readonly<{
  vault: Address;
  fieldHasher: Address;
  deploymentBlock: bigint;
}>;

export class ShieldedService {
  private readonly pathCache = new Map<string, Awaited<ReturnType<ShieldedService["buildPath"]>>>();

  constructor(
    private readonly client: PublicClient,
    private readonly config: Config,
  ) {}

  async path(commitment: Hex) {
    const [head, onchainRoot] = await Promise.all([
      this.client.getBlockNumber(),
      this.client.readContract({
        address: this.config.vault,
        abi: zkBlastVaultAbi,
        functionName: "root",
      }),
    ]);
    const cacheKey = `${onchainRoot.toLowerCase()}:${commitment.toLowerCase()}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached) return { ...cached, syncedBlock: head.toString() };
    const result = await this.buildPath(commitment, head, onchainRoot);
    this.pathCache.set(cacheKey, result);
    return result;
  }

  private async buildPath(commitment: Hex, head: bigint, onchainRoot: Hex) {
    const logs = await this.commitmentLogs(head);
    const leaves: Hex[] = [];
    for (const log of logs) {
      const index = Number(log.args.leafIndex);
      if (!Number.isSafeInteger(index) || index !== leaves.length)
        throw new Error("NON_SEQUENTIAL_COMMITMENT_TREE");
      leaves.push(log.args.commitment);
    }
    const target = leaves.findIndex(
      (leaf) => leaf.toLowerCase() === commitment.toLowerCase(),
    );
    if (target < 0) throw new Error("COMMITMENT_NOT_FOUND");

    const siblings: Hex[] = [];
    const directions: number[] = [];
    let index = target;
    let nodes = leaves;
    let zero = EMPTY_LEAF;
    for (let level = 0; level < DEPTH; level += 1) {
      const isRight = index % 2 === 1;
      siblings.push(isRight ? nodes[index - 1]! : (nodes[index + 1] ?? zero));
      directions.push(isRight ? 1 : 0);
      const pairs = Array.from(
        { length: Math.ceil(nodes.length / 2) },
        (_, pair) => [nodes[pair * 2] ?? zero, nodes[pair * 2 + 1] ?? zero] as const,
      );
      const [nextZero, ...nextNodes] = await Promise.all([
        this.hash(level, zero, zero),
        ...pairs.map(([left, right]) => this.hash(level, left, right)),
      ]);
      zero = nextZero;
      nodes = nextNodes;
      index = Math.floor(index / 2);
    }
    const root = nodes[0];
    if (!root || root.toLowerCase() !== onchainRoot.toLowerCase())
      throw new Error("MERKLE_ROOT_MISMATCH");
    return {
      commitment,
      leafIndex: target,
      root,
      siblings,
      directions,
      syncedBlock: head.toString(),
    };
  }

  private async commitmentLogs(head: bigint) {
    const event = zkBlastVaultAbi.find(
      (item) => item.type === "event" && item.name === "CommitmentDeposited",
    );
    if (!event) throw new Error("COMMITMENT_EVENT_ABI_MISSING");
    const logs = [];
    const chunk = 2_000n;
    for (let from = this.config.deploymentBlock; from <= head; from += chunk) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n;
      logs.push(
        ...(await this.client.getLogs({
          address: this.config.vault,
          event,
          fromBlock: from,
          toBlock: to,
          strict: true,
        })),
      );
    }
    return logs.sort((left, right) => {
      const block = Number(left.blockNumber - right.blockNumber);
      return block || Number(left.logIndex - right.logIndex);
    });
  }

  private hash(level: number, left: Hex, right: Hex): Promise<Hex> {
    return this.client.readContract({
      address: getAddress(this.config.fieldHasher),
      abi: hasherAbi,
      functionName: "hashMerkleNode",
      args: [BigInt(level), left, right],
    });
  }
}
