import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Address,
} from "viem";

import type { ExternalMarketService } from "../src/external-market-service.js";
import {
  TradeReceiptService,
  type ConfirmedTrade,
  type TradeHistoryWriter,
} from "../src/trade-receipt-service.js";

const wallet: Address = "0x1111111111111111111111111111111111111111";
const router: Address = "0x2222222222222222222222222222222222222222";
const pool: Address = "0x3333333333333333333333333333333333333333";
const base: Address = "0x4444444444444444444444444444444444444444";
const quote: Address = "0x5555555555555555555555555555555555555555";
const hash = `0x${"6".repeat(64)}` as const;
const routerAbi = parseAbi([
  "function swapDammExactInput(address pool,address tokenIn,uint256 amountIn,uint256 minimumAmountOut,address recipient,uint256 deadline) returns (uint256 amountOut)",
]);
const eventAbi = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,address indexed tokenIn,uint256 amountIn,uint256 amountOut,uint256 protocolFee)",
]);

function fixture(transactionFrom: Address = wallet) {
  let saved: ConfirmedTrade | undefined;
  const writer: TradeHistoryWriter = {
    walletAddress: async () => wallet,
    saveConfirmedTrade: async (_userId, _walletId, trade) => {
      saved = trade;
      return { status: "confirmed" };
    },
  };
  const marketService = {
    validatedRoute: async () => ({
      symbol: "AMD",
      chainId: 46_630,
      baseAddress: base,
      quoteAddress: quote,
      poolAddress: pool,
      venue: "zkblast_damm",
      baseDecimals: 18,
    }),
  } as unknown as ExternalMarketService;
  const topics = encodeEventTopics({
    abi: eventAbi,
    eventName: "Swap",
    args: { sender: router, recipient: wallet, tokenIn: base },
  }).filter((topic): topic is `0x${string}` => typeof topic === "string");
  const data = encodeAbiParameters(
    parseAbiParameters(
      "uint256 amountIn,uint256 amountOut,uint256 protocolFee",
    ),
    [1_000n, 199n, 3n],
  );
  const client = {
    getTransaction: async () => ({
      from: transactionFrom,
      to: router,
      input: encodeFunctionData({
        abi: routerAbi,
        functionName: "swapDammExactInput",
        args: [pool, base, 1_000n, 190n, wallet, 1_800_000_000n],
      }),
    }),
    getTransactionReceipt: async () => ({
      status: "success" as const,
      blockNumber: 123n,
      gasUsed: 50_000n,
      effectiveGasPrice: 10_000_000n,
      logs: [{ address: pool, data, topics, logIndex: 7 }],
    }),
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
  };
  return {
    service: new TradeReceiptService(
      client,
      marketService,
      writer,
      46_630,
      router,
    ),
    saved: () => saved,
  };
}

test("confirmed trade is derived from router calldata and pool receipt", async () => {
  const { service, saved } = fixture();
  await service.confirm(
    { userId: "user", walletId: "wallet" },
    {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      marketId: "22222222-2222-4222-8222-222222222222",
      quoteSymbol: "USDG",
      transactionHash: hash,
    },
  );
  assert.equal(saved()?.amountInRaw, "1000");
  assert.equal(saved()?.amountOutRaw, "199");
  assert.equal(saved()?.feeRaw, "3");
  assert.equal(saved()?.logIndex, 7);
  assert.deepEqual(service.metrics(), {
    confirmations: 1,
    failures: 0,
    windowSeconds: 900,
  });
});

test("a different wallet cannot claim a confirmed transaction", async () => {
  const { service } = fixture("0x9999999999999999999999999999999999999999");
  await assert.rejects(
    service.confirm(
      { userId: "user", walletId: "wallet" },
      {
        clientRequestId: "11111111-1111-4111-8111-111111111111",
        marketId: "22222222-2222-4222-8222-222222222222",
        quoteSymbol: "USDG",
        transactionHash: hash,
      },
    ),
    /TRADE_WALLET_MISMATCH/u,
  );
  assert.deepEqual(service.metrics(), {
    confirmations: 0,
    failures: 1,
    windowSeconds: 900,
  });
});
