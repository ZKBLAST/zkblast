import { Router } from "express";
import { z } from "zod";
import type { AssistanceFundService } from "./assistance-fund-service.js";

const address = z
  .string()
  .regex(/^0x[\da-f]{40}$/iu)
  .transform((value) => value.toLowerCase());
const hash = z
  .string()
  .regex(/^0x[\da-f]{64}$/iu)
  .transform((value) => value.toLowerCase());
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(256).optional(),
  asset: address.optional(),
  sourceId: hash.optional(),
});

export function createAssistanceFundRouter(service: AssistanceFundService) {
  const router = Router();
  router.get("/summary", async (request, response, next) => {
    try {
      const asset = address.optional().parse(request.query.asset);
      response.json(await service.summary(asset));
    } catch (error) {
      next(error);
    }
  });
  for (const [path, read] of [
    ["/revenue", service.revenue.bind(service)],
    ["/buybacks", service.buybacks.bind(service)],
    ["/burns", service.burns.bind(service)],
  ] as const) {
    router.get(path, async (request, response, next) => {
      try {
        const query = pageQuery.parse(request.query);
        response.json({
          items: await read({
            limit: query.limit,
            ...(query.cursor ? { cursor: query.cursor } : {}),
            ...(query.asset ? { asset: query.asset } : {}),
            ...(query.sourceId ? { sourceId: query.sourceId } : {}),
          }),
        });
      } catch (error) {
        next(error);
      }
    });
  }
  return router;
}
