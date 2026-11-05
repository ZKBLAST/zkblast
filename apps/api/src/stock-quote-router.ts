import { Router } from "express";
import { z } from "zod";

import type { StockQuoteService } from "./stock-quote-service.js";
import {
  applyValidatedStockQuoteObservation,
  buildStockQuotePreview,
  stockQuotePreviewRequestSchema,
} from "./stock-quote-preview.js";

const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/iu)
  .transform((value) => value.toLowerCase());
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  availability: z
    .enum([
      "listed",
      "eligible",
      "verified",
      "discovered",
      "suspended",
      "disabled",
    ])
    .optional(),
  quoteTradingEnabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
const bytes32 = z
  .string()
  .regex(/^0x[\da-f]{64}$/iu)
  .transform((value) => value.toLowerCase());
const receiptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  launchId: bytes32.optional(),
  quoteAssetAddress: address.optional(),
});
const receiptExportQuerySchema = receiptQuerySchema.extend({
  format: z.enum(["json", "csv"]).default("json"),
});
const publicReceiptFields = [
  "chainId",
  "transactionHash",
  "logIndex",
  "launchId",
  "quoteAssetAddress",
  "policyIdentity",
  "isBuy",
  "quoteAmountRaw",
  "quoteTokenDecimals",
  "multiplierX18",
  "oraclePriceX18",
  "usdNotionalX18",
  "oracleUpdatedAt",
  "oracleRoundId",
  "blockNumber",
  "blockHash",
  "observedAt",
] as const;

function publicReceipt(item: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    publicReceiptFields.map((field) => [field, item[field] ?? null]),
  );
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function receiptCsv(items: readonly Readonly<Record<string, unknown>>[]) {
  return [
    publicReceiptFields.join(","),
    ...items.map((item) =>
      publicReceiptFields.map((field) => csvCell(item[field])).join(","),
    ),
  ].join("\n");
}
function receiptQuery(value: z.infer<typeof receiptQuerySchema>) {
  return {
    limit: value.limit,
    ...(value.launchId ? { launchId: value.launchId } : {}),
    ...(value.quoteAssetAddress
      ? { quoteAssetAddress: value.quoteAssetAddress }
      : {}),
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
      if (!item)
        return response
          .status(404)
          .json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
      return response.json(item);
    } catch (error) {
      return next(error);
    }
  });
  router.get(
    "/assets/:contractAddress/destinations",
    async (request, response, next) => {
      try {
        const contractAddress = address.parse(request.params.contractAddress);
        const item = await service.asset(contractAddress);
        if (!item)
          return response
            .status(404)
            .json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
        return response.json({
          contractAddress,
          items: await service.destinationCapabilities(contractAddress),
        });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.get(
    "/assets/:contractAddress/launches",
    async (request, response, next) => {
      try {
        const contractAddress = address.parse(request.params.contractAddress);
        const query = querySchema.pick({ limit: true }).parse(request.query);
        const item = await service.asset(contractAddress);
        if (!item)
          return response
            .status(404)
            .json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
        return response.json({
          contractAddress,
          items: await service.launches(contractAddress, query.limit),
        });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.get(
    "/assets/:contractAddress/graduations",
    async (request, response, next) => {
      try {
        const contractAddress = address.parse(request.params.contractAddress);
        const query = querySchema.pick({ limit: true }).parse(request.query);
        const item = await service.asset(contractAddress);
        if (!item)
          return response
            .status(404)
            .json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
        return response.json({
          contractAddress,
          items: await service.graduations(contractAddress, query.limit),
        });
      } catch (error) {
        return next(error);
      }
    },
  );
  router.post("/preview", async (request, response, next) => {
    try {
      const previewRequest = stockQuotePreviewRequestSchema.parse(request.body);
      const item = await service.asset(previewRequest.contractAddress);
      if (!item)
        return response
          .status(404)
          .json({ error: { code: "STOCK_QUOTE_NOT_FOUND" } });
      const preview = buildStockQuotePreview({
        asset: item,
        destinations: await service.destinationCapabilities(
          previewRequest.contractAddress,
        ),
        request: previewRequest,
      });
      if (
        preview.operationAllowed &&
        (!preview.destinationRequired || preview.destinationEnabled) &&
        preview.oracleConfigured &&
        service.validatedUsdNotional
      ) {
        try {
          const observation = await service.validatedUsdNotional(
            previewRequest.contractAddress,
            previewRequest.operation,
            previewRequest.amountRaw,
          );
          return response.json(
            applyValidatedStockQuoteObservation(preview, observation),
          );
        } catch {
          // Reverted, stale and unavailable observations remain fail-closed previews.
        }
      }
      return response.json(preview);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/policy-bindings", async (request, response, next) => {
    try {
      const query = receiptQuerySchema.parse(request.query);
      return response.json({
        items: await service.launchPolicyBindings(receiptQuery(query)),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/execution-receipts", async (request, response, next) => {
    try {
      const query = receiptQuerySchema.parse(request.query);
      return response.json({
        items: await service.executionReceipts(receiptQuery(query)),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/execution-receipts/export", async (request, response, next) => {
    try {
      const query = receiptExportQuerySchema.parse(request.query);
      const items = await service.executionReceipts(receiptQuery(query));
      if (query.format === "csv") {
        response.setHeader("content-type", "text/csv; charset=utf-8");
        response.setHeader(
          "content-disposition",
          'attachment; filename="zkblast-stock-quote-receipts.csv"',
        );
        return response.send(receiptCsv(items));
      }
      return response.json({ items: items.map(publicReceipt) });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
