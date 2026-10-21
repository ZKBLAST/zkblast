import { getAddress, isHash } from "viem";
import { z } from "zod";
import type { BlockEnvelope, IndexedEvent } from "./domain.js";

const hexAddress = z.string().refine((value) => {
  try {
    getAddress(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid EVM address");

const hash = z.string().refine((value) => isHash(value), "Invalid EVM hash");
const payloadValue = z.union([
  z.string().max(2_048),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const secretPayloadKey =
  /(^|_)(secret|nonce|witness|path_siblings|path_directions|passphrase|private_key)($|_)/iu;

const eventSchema = z
  .object({
    chainId: z.number().int().positive(),
    blockNumber: z.bigint().nonnegative(),
    blockHash: hash,
    transactionHash: hash,
    logIndex: z.number().int().nonnegative().max(2_000_000),
    contractAddress: hexAddress,
    kind: z.enum([
      "pool",
      "swap",
      "position",
      "liquidity",
      "fee",
      "commitment",
      "private_intent",
      "root",
      "receipt",
    ]),
    eventName: z.string().min(1).max(128),
    payload: z.record(z.string().min(1).max(128), payloadValue),
  })
  .strict();

const blockSchema = z
  .object({
    number: z.bigint().nonnegative(),
    hash,
    parentHash: hash,
    events: z.array(eventSchema).max(20_000),
  })
  .strict();

export function validateBlockForPersistence(
  block: BlockEnvelope,
  expectedChainId: number,
): BlockEnvelope {
  const parsed = blockSchema.parse(block) as BlockEnvelope;
  for (const event of parsed.events) {
    if (event.chainId !== expectedChainId)
      throw new Error("EVENT_CHAIN_ID_MISMATCH");
    if (event.blockNumber !== parsed.number)
      throw new Error("EVENT_BLOCK_NUMBER_MISMATCH");
    if (event.blockHash.toLowerCase() !== parsed.hash.toLowerCase())
      throw new Error("EVENT_BLOCK_HASH_MISMATCH");
    rejectSecretPayload(event);
  }
  return parsed;
}

export function validateEventForPersistence(
  event: IndexedEvent,
  expectedChainId: number,
): IndexedEvent {
  const parsed = eventSchema.parse(event) as IndexedEvent;
  if (parsed.chainId !== expectedChainId)
    throw new Error("EVENT_CHAIN_ID_MISMATCH");
  rejectSecretPayload(parsed);
  return parsed;
}

function rejectSecretPayload(event: IndexedEvent): void {
  if (Object.keys(event.payload).some((key) => secretPayloadKey.test(key))) {
    throw new Error("SECRET_PAYLOAD_REJECTED");
  }
}
