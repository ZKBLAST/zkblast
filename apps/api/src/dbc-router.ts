import { Router } from "express";
import { getAddress } from "viem";
import { z } from "zod";
import type { DbcService } from "./dbc-service.js";

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

const launchId = z.string().regex(/^0x[\da-f]{64}$/iu).transform((value) => value.toLowerCase());
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(256).optional() });
const launchQuery = page.extend({ search: z.string().trim().min(1).max(64).optional(), lifecycle: z.coerce.number().int().min(0).max(4).optional() });
const candleQuery = z.object({
  interval: z.enum(["1m", "5m", "15m", "1h", "1d"]), from: z.coerce.date(), to: z.coerce.date(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
}).refine((input) => input.to > input.from && input.to.getTime() - input.from.getTime() <= 31 * 86_400_000, "Candle range must be within 31 days");
const quote = z.object({ pool: z.string().transform((value, context) => {
  try { return getAddress(value); } catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid pool address" }); return z.NEVER; }
}), side: z.enum(["buy", "sell"]), amountRaw: z.string().regex(/^[1-9]\d*$/u) }).strict();

export function createDbcRouter(service: DbcService) {
  const router = Router();
  router.get("/templates", async (request, response, next) => {
    try { response.json({ items: await service.templates(page.parse(request.query)) }); } catch (error) { next(error); }
  });
  router.get("/templates/:templateId/economics", async (request, response, next) => {
    try {
      const templateId = z.coerce.bigint().positive().parse(request.params.templateId);
      response.json(jsonSafe(await service.templateEconomics(templateId)));
    } catch (error) { next(error); }
  });
  router.get("/launches", async (request, response, next) => {
    try { response.json({ items: await service.launches(launchQuery.parse(request.query)) }); } catch (error) { next(error); }
  });
  router.get("/launches/:launchId", async (request, response, next) => {
    try { const id = launchId.parse(request.params.launchId); const item = await service.launch(id); response.status(item ? 200 : 404).json(item ?? { error: { code: "DBC_LAUNCH_NOT_FOUND" } }); } catch (error) { next(error); }
  });
  router.get("/launches/:launchId/trades", async (request, response, next) => {
    try { response.json({ items: await service.trades(launchId.parse(request.params.launchId), page.parse(request.query)) }); } catch (error) { next(error); }
  });
  router.get("/launches/:launchId/candles", async (request, response, next) => {
    try { response.json({ items: await service.candles(launchId.parse(request.params.launchId), candleQuery.parse(request.query)) }); } catch (error) { next(error); }
  });
  router.get("/launches/:launchId/graduation", async (request, response, next) => {
    try { const item = await service.graduation(launchId.parse(request.params.launchId)); response.status(item ? 200 : 404).json(item ?? { error: { code: "DBC_GRADUATION_NOT_FOUND" } }); } catch (error) { next(error); }
  });
  router.post("/quote", async (request, response, next) => {
    try { const input = quote.parse(request.body); response.json(jsonSafe(await service.quote(input.pool, input.side, BigInt(input.amountRaw)))); } catch (error) { next(error); }
  });
  router.get("/deployment", (_request, response) => { response.json(service.deploymentInfo()); });
  return router;
}
