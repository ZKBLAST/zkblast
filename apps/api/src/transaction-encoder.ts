import { encodeFunctionData, type Address, type Hex } from "viem";

export type PreparedTransaction = Readonly<{
  to: Address;
  data: Hex;
  value: "0x0";
}>;

export function encodeTransaction(
  call: Readonly<{
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }>,
): PreparedTransaction {
  return {
    to: call.address,
    data: encodeFunctionData(call as Parameters<typeof encodeFunctionData>[0]),
    value: "0x0",
  };
}
