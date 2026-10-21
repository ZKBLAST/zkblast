import { getAddress, type Address } from "viem";

/** Do not pass getAddress directly to Array.map: its second parameter is chainId. */
export function normalizeSafeOwners(addresses: readonly string[]): Address[] {
  const owners = addresses
    .map((address) => getAddress(address))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (new Set(owners).size !== owners.length)
    throw new Error("DUPLICATE_SAFE_OWNER");
  return owners;
}
