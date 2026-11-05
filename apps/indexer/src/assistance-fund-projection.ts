import type { Address, Hex } from "viem";
import type { IndexedEvent } from "./domain.js";

type ReceiptBase = Readonly<{
  chainId: number;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
}>;

export type AssistanceProjection =
  | (ReceiptBase &
      Readonly<{
        kind: "source";
        sourceId: Hex;
        sourceAddress: Address;
        assetAddress: Address;
        adapterId: Hex;
        status: number;
      }>)
  | (ReceiptBase &
      Readonly<{
        kind: "revenue";
        sourceId: Hex;
        epochId: Hex;
        assetAddress: Address;
        revenueKind: number;
        grossAmountRaw: bigint;
        excludedObligationsRaw: bigint;
        eligibleAmountRaw: bigint;
      }>)
  | (ReceiptBase &
      Readonly<{
        kind: "allocation";
        sourceId: Hex;
        epochId: Hex;
        assetAddress: Address;
        eligibleAmountRaw: bigint;
        buybackAmountRaw: bigint;
        treasuryAmountRaw: bigint;
      }>)
  | (ReceiptBase &
      Readonly<{
        kind: "buyback";
        routeId: Hex;
        assetIn: Address;
        protocolToken: Address;
        amountInRaw: bigint;
        amountOutRaw: bigint;
        referencePriceX18: bigint;
        executionPriceX18: bigint;
        executorAddress: Address;
      }>)
  | (ReceiptBase &
      Readonly<{
        kind: "burn";
        protocolToken: Address;
        burnMethod: number;
        amountRaw: bigint;
        totalSupplyBeforeRaw: bigint;
        totalSupplyAfterRaw: bigint;
        executorAddress: Address;
      }>);

const text = (event: IndexedEvent, key: string): string | null => {
  const value = event.payload[key];
  return typeof value === "string" ? value : null;
};
const integer = (event: IndexedEvent, key: string): number | null => {
  const value = event.payload[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return null;
};
const amount = (event: IndexedEvent, key: string): bigint | null => {
  const value = text(event, key);
  return value && /^\d+$/u.test(value) ? BigInt(value) : null;
};
const address = (event: IndexedEvent, key: string): Address | null => {
  const value = text(event, key)?.toLowerCase();
  return value && /^0x[\da-f]{40}$/u.test(value) ? (value as Address) : null;
};
const hash = (event: IndexedEvent, key: string): Hex | null => {
  const value = text(event, key)?.toLowerCase();
  return value && /^0x[\da-f]{64}$/u.test(value) ? (value as Hex) : null;
};
const base = (event: IndexedEvent): ReceiptBase => ({
  chainId: event.chainId,
  transactionHash: event.transactionHash,
  logIndex: event.logIndex,
  blockNumber: event.blockNumber,
});

/** Projects only canonical contract receipts; protocol ownership is never inferred here. */
export function projectAssistanceFundEvent(
  event: IndexedEvent,
): AssistanceProjection | null {
  if (event.eventName === "ProtocolFeeSourceUpdated") {
    const sourceId = hash(event, "sourceId"),
      sourceAddress = address(event, "source");
    const assetAddress = address(event, "asset"),
      adapterId = hash(event, "adapterId");
    const status = integer(event, "status");
    return sourceId &&
      sourceAddress &&
      assetAddress &&
      adapterId &&
      status !== null
      ? {
          ...base(event),
          kind: "source",
          sourceId,
          sourceAddress,
          assetAddress,
          adapterId,
          status,
        }
      : null;
  }
  if (event.eventName === "ProtocolRevenueRecorded") {
    const sourceId = hash(event, "sourceId"),
      epochId = hash(event, "epochId");
    const assetAddress = address(event, "asset"),
      revenueKind = integer(event, "kind");
    const grossAmountRaw = amount(event, "grossAmount");
    const excludedObligationsRaw = amount(event, "excludedObligations");
    const eligibleAmountRaw = amount(event, "eligibleAmount");
    if (
      !sourceId ||
      !epochId ||
      !assetAddress ||
      revenueKind === null ||
      grossAmountRaw === null ||
      excludedObligationsRaw === null ||
      eligibleAmountRaw === null ||
      grossAmountRaw !== excludedObligationsRaw + eligibleAmountRaw
    )
      return null;
    return {
      ...base(event),
      kind: "revenue",
      sourceId,
      epochId,
      assetAddress,
      revenueKind,
      grossAmountRaw,
      excludedObligationsRaw,
      eligibleAmountRaw,
    };
  }
  if (event.eventName === "ProtocolFeeAllocated") {
    const sourceId = hash(event, "sourceId"),
      epochId = hash(event, "epochId"),
      assetAddress = address(event, "asset");
    const eligibleAmountRaw = amount(event, "eligibleAmount"),
      buybackAmountRaw = amount(event, "buybackAmount"),
      treasuryAmountRaw = amount(event, "treasuryAmount");
    if (
      !sourceId ||
      !epochId ||
      !assetAddress ||
      eligibleAmountRaw === null ||
      buybackAmountRaw === null ||
      treasuryAmountRaw === null ||
      eligibleAmountRaw !== buybackAmountRaw + treasuryAmountRaw
    )
      return null;
    return {
      ...base(event),
      kind: "allocation",
      sourceId,
      epochId,
      assetAddress,
      eligibleAmountRaw,
      buybackAmountRaw,
      treasuryAmountRaw,
    };
  }
  if (event.eventName === "BuybackExecuted") {
    const routeId = hash(event, "routeId"),
      assetIn = address(event, "assetIn"),
      protocolToken = address(event, "protocolToken"),
      executorAddress = address(event, "executor");
    const amountInRaw = amount(event, "amountIn"),
      amountOutRaw = amount(event, "amountOut"),
      referencePriceX18 = amount(event, "referencePriceX18"),
      executionPriceX18 = amount(event, "executionPriceX18");
    return routeId &&
      assetIn &&
      protocolToken &&
      executorAddress &&
      amountInRaw &&
      amountOutRaw &&
      referencePriceX18 !== null &&
      executionPriceX18 !== null
      ? {
          ...base(event),
          kind: "buyback",
          routeId,
          assetIn,
          protocolToken,
          amountInRaw,
          amountOutRaw,
          referencePriceX18,
          executionPriceX18,
          executorAddress,
        }
      : null;
  }
  if (event.eventName === "ProtocolTokensBurned") {
    const protocolToken = address(event, "protocolToken"),
      burnMethod = integer(event, "method"),
      executorAddress = address(event, "executor");
    const amountRaw = amount(event, "amount"),
      totalSupplyBeforeRaw = amount(event, "totalSupplyBefore"),
      totalSupplyAfterRaw = amount(event, "totalSupplyAfter");
    return protocolToken &&
      burnMethod !== null &&
      executorAddress &&
      amountRaw &&
      totalSupplyBeforeRaw !== null &&
      totalSupplyAfterRaw !== null &&
      totalSupplyBeforeRaw >= totalSupplyAfterRaw
      ? {
          ...base(event),
          kind: "burn",
          protocolToken,
          burnMethod,
          amountRaw,
          totalSupplyBeforeRaw,
          totalSupplyAfterRaw,
          executorAddress,
        }
      : null;
  }
  return null;
}

export function assistanceReconciliationIssues(
  input: Readonly<{
    balanceRaw: bigint;
    pendingBuybackRaw: bigint;
    treasuryClaimableRaw: bigint;
    liabilityRaw: bigint;
    surplusRaw: bigint;
    solvent: boolean;
  }>,
): readonly string[] {
  const issues: string[] = [];
  if (
    input.liabilityRaw !==
    input.pendingBuybackRaw + input.treasuryClaimableRaw
  )
    issues.push("LIABILITY_MISMATCH");
  if (input.balanceRaw !== input.liabilityRaw + input.surplusRaw)
    issues.push("BALANCE_MISMATCH");
  if (!input.solvent || input.balanceRaw < input.liabilityRaw)
    issues.push("INSOLVENT");
  return issues;
}
