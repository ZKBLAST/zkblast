import { z } from "zod";
import type { IndexedEvent } from "./domain.js";

const receiptPayloadSchema = z
  .object({
    status: z.enum(["success", "reverted"]),
    gasUsed: z.string().regex(/^\d+$/u),
    effectiveGasPrice: z.string().regex(/^\d+$/u),
  })
  .strict();

export type TransactionObservation = Readonly<{
  chainId: number;
  transactionHash: string;
  status: "confirmed" | "reverted";
  blockNumber: bigint;
  gasUsed: string;
  effectiveGasPriceWei: string;
}>;

export function transactionObservation(
  event: IndexedEvent,
): TransactionObservation | null {
  if (event.kind !== "receipt" || event.eventName !== "TransactionReceipt")
    return null;
  const payload = receiptPayloadSchema.parse(event.payload);
  return {
    chainId: event.chainId,
    transactionHash: event.transactionHash.toLowerCase(),
    status: payload.status === "success" ? "confirmed" : "reverted",
    blockNumber: event.blockNumber,
    gasUsed: payload.gasUsed,
    effectiveGasPriceWei: payload.effectiveGasPrice,
  };
}
