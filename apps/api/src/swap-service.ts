import {
  buildApproval,
  buildDammSwap,
  buildDlmmSwap,
  minimumAmountOut,
  normalizeTransactionError,
  quoteDammExactInput,
  quoteDlmmExactInput,
  type ContractReader,
  type ProtocolAddresses,
} from "@zkblast/sdk";
import { getAddress, type Address } from "viem";
import { encodeTransaction } from "./transaction-encoder.js";

export type SwapQuoteInput = Readonly<{
  model: "damm" | "dlmm";
  pool: string;
  tokenIn: string;
  amountIn: string;
  slippageBps: number;
  recipient: string;
  deadline: string;
  token0ToToken1?: boolean | undefined;
  maximumBinCrossings?: number | undefined;
}>;

export class SwapService {
  constructor(
    private readonly client: ContractReader,
    private readonly addresses: ProtocolAddresses,
    private readonly chainId: number,
    private readonly isRegisteredPool: (pool: Address) => Promise<boolean>,
  ) {}

  async quote(input: SwapQuoteInput) {
    try {
      const pool = getAddress(input.pool);
      const tokenIn = getAddress(input.tokenIn);
      const recipient = getAddress(input.recipient);
      const amountIn = BigInt(input.amountIn);
      const deadline = BigInt(input.deadline);
      if (amountIn <= 0n || deadline <= 0n)
        throw new Error("INVALID_SWAP_INPUT");
      if (!(await this.isRegisteredPool(pool)))
        throw new Error("UNREGISTERED_POOL");

      const quote =
        input.model === "damm"
          ? await quoteDammExactInput(
              this.client,
              this.addresses.poolQuoter,
              pool,
              tokenIn,
              amountIn,
            )
          : await quoteDlmmExactInput(
              this.client,
              this.addresses.poolQuoter,
              pool,
              input.token0ToToken1 ?? true,
              amountIn,
              input.maximumBinCrossings ?? 16,
            );
      const minimumOut = minimumAmountOut(quote.amountOut, input.slippageBps);
      const swap =
        input.model === "damm"
          ? buildDammSwap({
              router: this.addresses.swapRouter,
              pool,
              tokenIn,
              amountIn,
              minimumAmountOut: minimumOut,
              recipient,
              deadline,
            })
          : buildDlmmSwap({
              router: this.addresses.swapRouter,
              pool,
              token0ToToken1: input.token0ToToken1 ?? true,
              amountIn,
              minimumAmountOut: minimumOut,
              maximumBinCrossings: input.maximumBinCrossings ?? 16,
              recipient,
              deadline,
            });
      return {
        chainId: this.chainId,
        amountOut: quote.amountOut.toString(),
        minimumAmountOut: minimumOut.toString(),
        approval: encodeTransaction(
          buildApproval(tokenIn, this.addresses.swapRouter, amountIn),
        ),
        swap: encodeTransaction(swap),
      };
    } catch (error) {
      throw normalizeTransactionError(error);
    }
  }
}
