import { getAddress, isHash, type Hex } from "viem";
import type { IndexedEvent } from "./domain.js";

export type ProtectedProjection = Readonly<{
  kind:
    | "policy"
    | "launch"
    | "metadata"
    | "purchase"
    | "lp_allocation"
    | "lp_claim"
    | "identity";
  identity: string;
  launchId?: Hex | undefined;
  policyId?: bigint | undefined;
  migrationId?: Hex | undefined;
  account?: string | undefined;
  payload: IndexedEvent["payload"];
}>;

const kinds = new Map<string, ProtectedProjection["kind"]>([
  ["ProtectionPolicyCreated", "policy"],
  ["ProtectionPolicyStatusUpdated", "policy"],
  ["ProtectionPolicyUsed", "policy"],
  ["ProtectedTokenLaunched", "launch"],
  ["ProtectedLaunchMetadataPublished", "metadata"],
  ["ProtectedPurchaseRecorded", "purchase"],
  ["ProtectedAllocationRegistered", "lp_allocation"],
  ["ProtectedAllocationClaimed", "lp_claim"],
  ["ProtectedLaunchIdentityRegistered", "identity"],
  ["ProtectedLaunchIdentityBoundToLaunchpad", "identity"],
]);

function optionalHash(event: IndexedEvent, key: string): Hex | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isHash(value))
    throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return value.toLowerCase() as Hex;
}

function optionalUint(event: IndexedEvent, key: string): bigint | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return BigInt(value);
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return BigInt(value);
}

function optionalAddress(event: IndexedEvent, key: string): string | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return getAddress(value).toLowerCase();
}

export function protectedProjectionFromEvent(
  event: IndexedEvent,
): ProtectedProjection | null {
  const kind = kinds.get(event.eventName);
  if (!kind) return null;
  if (event.kind !== "launch") throw new Error("INVALID_PROTECTED_EVENT_KIND");
  const launchId = optionalHash(event, "launchId");
  const policyId = optionalUint(event, "policyId");
  const migrationId = optionalHash(event, "migrationId");
  const account =
    optionalAddress(event, "buyer") ?? optionalAddress(event, "recipient");
  if (kind === "launch" && (!launchId || policyId === undefined))
    throw new Error("INVALID_PROTECTED_LAUNCH_BINDING");
  if ((kind === "lp_allocation" || kind === "lp_claim") && !migrationId)
    throw new Error("INVALID_PROTECTED_MIGRATION");
  return {
    kind,
    identity: `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`,
    launchId,
    policyId,
    migrationId,
    account,
    payload: event.payload,
  };
}
