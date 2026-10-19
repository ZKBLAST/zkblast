import { Router } from "express";
import { z } from "zod";

import type { ExternalMarketService } from "./external-market-service.js";
import type { SwapService } from "./swap-service.js";
import { parseUnits } from "viem";

const querySchema = z.object({
  source: z.enum(["pons_graduated", "robinhood_stock_token"]).optional(),
  region: z.enum(["unclassified", "crypto", "us", "china"]).optional(),
  minMarketCapUsd: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(25),
  cursor: z.string().uuid().optional(),
});

const chartQuerySchema = z
  .object({
    source: z.enum(["swap", "oracle", "reference"]),
    from: z.coerce.date(),
    to: z.coerce.date(),
    limit: z.coerce.number().int().min(1).max(2_000).default(500),
  })
  .refine((value) => value.to > value.from, {
    message: "to must be after from",
  })
  .refine(
    (value) => value.to.getTime() - value.from.getTime() <= 31 * 86_400_000,
    { message: "chart range cannot exceed 31 days" },
  );

const marketIdSchema = z.string().uuid();
const quoteBodySchema = z
  .object({
    quoteSymbol: z.enum(["USDG", "WETH"]),
    amount: z.string().regex(/^\d+(?:\.\d{1,18})?$/u),
    slippageBps: z.number().int().min(1).max(500),
    recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/u),
    deadline: z.string().regex(/^\d+$/u),
  })
  .strict();

export function createExternalMarketRouter(
  service: ExternalMarketService,
  swapService?: SwapService,
) {
  const router = Router();
  router.get("/", async (request, response, next) => {
    try {
      const items = await service.list(querySchema.parse(request.query));
      response.json({ items, nextCursor: items.at(-1)?.id ?? null });
    } catch (error) {
      next(error);
    }
  });
  router.get("/:marketId/chart", async (request, response, next) => {
    try {
      const marketId = marketIdSchema.parse(request.params.marketId);
      const query = chartQuerySchema.parse(request.query);
      const items = await service.priceHistory(marketId, query);
      response.json({
        marketId,
        source: query.source,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        items,
      });
    } catch (error) {
      next(error);
    }
  });
  if (swapService)
    router.post("/:marketId/quote", async (request, response, next) => {
      try {
        const marketId = marketIdSchema.parse(request.params.marketId);
        const body = quoteBodySchema.parse(request.body);
        const route = await service.validatedRoute(marketId, body.quoteSymbol);
        const amountIn = parseUnits(body.amount, route.baseDecimals);
        const quote = await swapService.quote({
          model: route.venue === "zkblast_damm" ? "damm" : "dlmm",
          pool: route.poolAddress,
          tokenIn: route.baseAddress,
          amountIn: amountIn.toString(),
          slippageBps: body.slippageBps,
          recipient: body.recipient,
          deadline: body.deadline,
          token0ToToken1: true,
          maximumBinCrossings: 16,
        });
        response.json({
          ...quote,
          marketId,
          symbol: route.symbol,
          quoteSymbol: body.quoteSymbol,
          amountIn: amountIn.toString(),
          baseDecimals: route.baseDecimals,
          poolAddress: route.poolAddress,
        });
      } catch (error) {
        next(error);
      }
    });
  return router;
}
