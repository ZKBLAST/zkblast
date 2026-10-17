import { getAddress, type Address } from "viem";

import { SdkError } from "./errors.js";

export type VerifiedVenue = Readonly<{
  name: string;
  chainId: number;
  address: Address;
  sourceVerificationUrl: string;
  auditReference: string;
}>;

export interface ExternalVenueAdapter<TQuote, TCall> {
  readonly venue: VerifiedVenue;
  quote(input: unknown): Promise<TQuote>;
  prepare(input: unknown): TCall;
}

export function defineVerifiedVenue(input: VerifiedVenue): VerifiedVenue {
  if (
    !input.name.trim() ||
    !Number.isInteger(input.chainId) ||
    input.chainId <= 0
  ) {
    throw new SdkError(
      "INVALID_ADAPTER",
      "Venue name and chain ID are required",
    );
  }
  for (const [label, value] of [
    ["source verification", input.sourceVerificationUrl],
    ["audit", input.auditReference],
  ] as const) {
    try {
      new URL(value);
    } catch {
      throw new SdkError(
        "INVALID_ADAPTER",
        `Verified venue ${label} URL is invalid`,
      );
    }
  }
  return { ...input, address: getAddress(input.address) };
}
