import { Router } from "express";
import { z } from "zod";

import type { StockQuoteService } from "./stock-quote-service.js";

const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/iu)
  .transform((value) => value.toLowerCase());
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  availability: z
    .enum(["listed", "eligible", "verified", "discovered", "suspended", "disabled"])
    .optional(),
  quoteTradingEnabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
const bytes32 = z.string().regex(/^0x[\da-f]{64}$/iu).transform((value) => value.toLowerCase());
const receiptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  launchId: bytes32.optional(),
  quoteAssetAddress: address.optional(),
});
function receiptQuery(value: z.infer<typeof receiptQuerySchema>) {
  return {
    limit: value.limit,
    ...(value.launchId ? { launchId: value.launchId } : {}),
    ...(value.quoteAssetAddress ? { quoteAssetAddress: value.quoteAssetAddress } : {}),
  };
}

export function createStockQuoteRouter(service: StockQuoteService) {
  const router = Router();
  router.get("/assets", async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      response.json({
        items: await service.assets({
          limit: query.limit,
          ...(query.availability ? { availability: query.availability } : {}),
          ...(query.quoteTradingEnabled === undefined
            ? {}
            : { quoteTradingEnabled: query.quoteTradingEnabled }),
        }),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/assets/:contractAddress", async (request, response, next) => {
    try {
      const contractAddress = address.parse(request.params.contractAddress);
      const item = await service.asset(contractAddress);
      if (!item) return response.status(404).json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
      return response.json(item);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/assets/:contractAddress/destinations", async (request, response, next) => {
    try {
      const contractAddress = address.parse(request.params.contractAddress);
      const item = await service.asset(contractAddress);
      if (!item) return response.status(404).json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
      return response.json({
        contractAddress,
        items: await service.destinationCapabilities(contractAddress),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/policy-bindings", async (request, response, next) => {
    try {
      const query = receiptQuerySchema.parse(request.query);
      return response.json({ items: await service.launchPolicyBindings(receiptQuery(query)) });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/execution-receipts", async (request, response, next) => {
    try {
      const query = receiptQuerySchema.parse(request.query);
      return response.json({ items: await service.executionReceipts(receiptQuery(query)) });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
