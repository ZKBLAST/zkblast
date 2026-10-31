import { encodeFunctionData, type Address, type Hex } from "viem";
import { buildApproval, DbcClient, type DbcAddresses, type PreparedContractCall } from "@zkblast/sdk";
import type { EthereumProvider } from "@/types/application";
import { executeTransactions, type PreparedTransaction } from "./swap-flow";

export function contractCallTransaction(call: PreparedContractCall): PreparedTransaction {
  return { to: call.address, data: encodeFunctionData(call as Parameters<typeof encodeFunctionData>[0]), value: "0x0" };
}
export function dbcClient(addresses: DbcAddresses) { return new DbcClient(addresses); }
export function approvalTransaction(token: Address, spender: Address, amount: bigint) {
  return contractCallTransaction(buildApproval(token,spender,amount));
}
export async function executeDbcTransactions(input: Readonly<{
  provider: EthereumProvider; account: string; chainId: number; calls: readonly PreparedTransaction[];
  action: string; onStatus: (status: string)=>void;
}>) {
  return executeTransactions(input.provider,input.account,input.chainId,input.calls,(state)=>input.onStatus(state.replaceAll("-"," ")),input.action);
}
export type DbcQuoteResponse = Readonly<{
  grossQuoteConsumedRaw?: string; netQuoteRaw?: string; baseOutRaw?: string;
  baseInRaw?: string; grossQuoteOutRaw?: string; netQuoteOutRaw?: string;
  feeRaw: string; finalPriceX18: string;
}>;
export function bytes32Salt(): Hex { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)),(byte)=>byte.toString(16).padStart(2,"0")).join("")}`; }
