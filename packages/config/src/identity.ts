import { getChainDescriptor } from "./chains.js";

export type ChainEntityKind =
  | "launchpad"
  | "launch"
  | "token"
  | "pool"
  | "transaction"
  | "metadata";

export type ChainEntityIdentity = Readonly<{
  chainId: number;
  kind: ChainEntityKind;
  identifier: string;
  key: string;
}>;

const addressPattern = /^0x[\da-f]{40}$/iu;
const hashPattern = /^0x[\da-f]{64}$/iu;
const metadataPattern = /^(?:0x)?[\da-f]{64}$/iu;
const unsignedIntegerPattern = /^\d+$/u;

function normalizeIdentifier(
  kind: ChainEntityKind,
  identifier: string | bigint,
): string {
  const value = typeof identifier === "bigint" ? identifier.toString() : identifier;

  if (kind === "launchpad") {
    if (!unsignedIntegerPattern.test(value)) {
      throw new Error("CHAIN_ENTITY_LAUNCHPAD_ID_INVALID");
    }
    return BigInt(value).toString();
  }
  if (kind === "token" || kind === "pool") {
    if (!addressPattern.test(value)) {
      throw new Error("CHAIN_ENTITY_ADDRESS_INVALID");
    }
    return value.toLowerCase();
  }
  if (kind === "launch" || kind === "transaction") {
    if (!hashPattern.test(value)) {
      throw new Error("CHAIN_ENTITY_HASH_INVALID");
    }
    return value.toLowerCase();
  }
  if (!metadataPattern.test(value)) {
    throw new Error("CHAIN_ENTITY_METADATA_ID_INVALID");
  }
  return value.replace(/^0x/u, "").toLowerCase();
}

export function createChainEntityIdentity(
  chainId: number,
  kind: ChainEntityKind,
  identifier: string | bigint,
): ChainEntityIdentity {
  getChainDescriptor(chainId);
  const normalizedIdentifier = normalizeIdentifier(kind, identifier);
  return {
    chainId,
    kind,
    identifier: normalizedIdentifier,
    key: `${chainId}:${kind}:${normalizedIdentifier}`,
  };
}

export function createChainObjectKey(
  chainId: number,
  kind: ChainEntityKind,
  identifier: string | bigint,
): string {
  const identity = createChainEntityIdentity(chainId, kind, identifier);
  const descriptor = getChainDescriptor(chainId);
  return `${descriptor.slug}/${identity.kind}/${identity.identifier}`;
}
