import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import type { ExternalMarketService } from "./external-market-service.js";

const routerAbi = parseAbi([
  "function swapDammExactInput(address pool,address tokenIn,uint256 amountIn,uint256 minimumAmountOut,address recipient,uint256 deadline) returns (uint256 amountOut)",
]);
const swapEvent = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,address indexed tokenIn,uint256 amountIn,uint256 amountOut,uint256 protocolFee)",
]);

export type ConfirmedTrade = Readonly<{
  clientRequestId: string;
  chainId: number;
  transactionHash: string;
  logIndex: number;
  venue: string;
  poolAddress: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  amountInRaw: string;
  amountOutRaw: string;
  feeRaw: string;
  blockNumber: string;
  blockTimestamp: Date;
  gasUsed: string;
  effectiveGasPriceWei: string;
}>;

export interface TradeHistoryWriter {
  walletAddress(walletId: string): Promise<string>;
  saveConfirmedTrade(
    userId: string,
    walletId: string,
    trade: ConfirmedTrade,
  ): Promise<unknown>;
}

type ChainReader = Readonly<{
  getTransaction(input: { hash: Hash }): Promise<{
    from: Address;
    to: Address | null;
    input: `0x${string}`;
  }>;
  getTransactionReceipt(input: { hash: Hash }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    logs: readonly Readonly<{
      address: Address;
      data: `0x${string}`;
      topics: readonly Hex[];
      logIndex: number | null;
    }>[];
  }>;
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}>;

export class TradeReceiptService {
  constructor(
    private readonly client: ChainReader,
    private readonly marketService: ExternalMarketService,
    private readonly writer: TradeHistoryWriter,
    private readonly chainId: number,
    private readonly swapRouter: Address,
  ) {}

  async confirm(
    identity: Readonly<{ userId: string; walletId: string }>,
    input: Readonly<{
      clientRequestId: string;
      marketId: string;
      quoteSymbol: "USDG" | "WETH";
      transactionHash: string;
    }>,
  ) {
    const hash = input.transactionHash as Hash;
    const [wallet, route, transaction, receipt] = await Promise.all([
      this.writer.walletAddress(identity.walletId),
      this.marketService.validatedRoute(input.marketId, input.quoteSymbol),
      this.client.getTransaction({ hash }),
      this.client.getTransactionReceipt({ hash }),
    ]);
    const expectedWallet = getAddress(wallet);
    if (getAddress(transaction.from) !== expectedWallet)
      throw new Error("TRADE_WALLET_MISMATCH");
    if (
      !transaction.to ||
      getAddress(transaction.to) !== getAddress(this.swapRouter)
    )
      throw new Error("INVALID_SWAP_TARGET");
    if (receipt.status !== "success") throw new Error("TRANSACTION_REVERTED");
    const decoded = decodeFunctionData({
      abi: routerAbi,
      data: transaction.input,
    });
    if (decoded.functionName !== "swapDammExactInput")
      throw new Error("INVALID_SWAP_CALL");
    const [pool, tokenIn, amountIn, , recipient] = decoded.args;
    if (
      getAddress(pool) !== getAddress(route.poolAddress) ||
      getAddress(tokenIn) !== getAddress(route.baseAddress) ||
      getAddress(recipient) !== expectedWallet
    )
      throw new Error("SWAP_ROUTE_MISMATCH");
    const log = receipt.logs.find(
      (candidate) =>
        getAddress(candidate.address) === getAddress(route.poolAddress),
    );
    if (!log || log.logIndex === null || log.topics.length === 0)
      throw new Error("SWAP_EVENT_MISSING");
    const event = decodeEventLog({
      abi: swapEvent,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
    });
    if (
      event.eventName !== "Swap" ||
      getAddress(event.args.recipient) !== expectedWallet ||
      getAddress(event.args.tokenIn) !== getAddress(route.baseAddress) ||
      event.args.amountIn !== amountIn
    )
      throw new Error("SWAP_EVENT_MISMATCH");
    const block = await this.client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    return this.writer.saveConfirmedTrade(identity.userId, identity.walletId, {
      clientRequestId: input.clientRequestId,
      chainId: this.chainId,
      transactionHash: hash.toLowerCase(),
      logIndex: log.logIndex,
      venue: route.venue,
      poolAddress: route.poolAddress,
      tokenInAddress: route.baseAddress,
      tokenOutAddress: route.quoteAddress,
      amountInRaw: event.args.amountIn.toString(),
      amountOutRaw: event.args.amountOut.toString(),
      feeRaw: event.args.protocolFee.toString(),
      blockNumber: receipt.blockNumber.toString(),
      blockTimestamp: new Date(Number(block.timestamp) * 1_000),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    });
  }
}
