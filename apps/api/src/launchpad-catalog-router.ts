import { Router } from "express";
import { getAddress } from "viem";
import { z } from "zod";
import type { LaunchpadCatalogService } from "./launchpad-catalog-service.js";
import type { LaunchpadReadService } from "./launchpad-read-service.js";

export function createLaunchpadCatalogRouter(service: LaunchpadCatalogService, readService?: LaunchpadReadService) {
  const router = Router();
  const limit = z.coerce.number().int().min(1).max(100).default(25);
  const launchpadId = z.string().regex(/^[1-9]\d*$/u);
  if (readService) {
    const eventQuery = z.object({
      cursor: z.string().regex(/^\d+:\d+$/u).default("0:0"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    });
    router.get("/health", async (_request,response,next) => {
      try { response.json(await readService.health()); } catch (error) { next(error); }
    });
    router.get("/events", async (request,response,next) => {
      try {
        const input = eventQuery.parse(request.query);
        const [block,logIndex] = input.cursor.split(":");
        response.set("cache-control","no-store");
        response.json(await readService.events(block!,Number(logIndex),input.limit));
      } catch (error) { next(error); }
    });
    router.get("/events/stream", async (request,response,next) => {
      try {
        const input = eventQuery.parse({ ...request.query, cursor: request.get("last-event-id") ?? request.query.cursor });
        let [block,logIndexText] = input.cursor.split(":");
        let logIndex = Number(logIndexText);
        response.set({ "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        response.flushHeaders();
        let polling = false;
        const emit = async () => {
          if (polling || response.writableEnded) return;
          polling = true;
          try {
            const envelope = await readService.events(block!,logIndex,input.limit);
            for (const item of envelope.data.items as Array<{ block_number: string; log_index: number }>) {
              const id = `${item.block_number}:${item.log_index}`;
              response.write(`id: ${id}\nevent: launchpad\ndata: ${JSON.stringify({ environment: envelope.environment, chainId: envelope.chainId, event: item })}\n\n`);
              [block,logIndexText] = id.split(":");
              logIndex = Number(logIndexText);
            }
            if (!response.writableEnded) response.write(": keepalive\n\n");
          } finally {
            polling = false;
          }
        };
        await emit();
        const interval = setInterval(() => void emit().catch(() => response.end()),2_000);
        const lifetime = setTimeout(() => response.end(),25_000);
        request.on("close",() => { clearInterval(interval); clearTimeout(lifetime); });
      } catch (error) { next(error); }
    });
    router.get("/", async (request,response,next) => {
      try {
        const input = z.object({ limit, cursor: z.string().regex(/^\d+:\d+$/u).optional() }).parse(request.query);
        response.json(await readService.list(input.limit,input.cursor));
      } catch (error) { next(error); }
    });
    router.get("/:launchpadId/data", async (request,response,next) => {
      try { response.json(await readService.detail(launchpadId.parse(request.params.launchpadId))); } catch (error) { next(error); }
    });
    for (const resource of ["tokens","trades","graduations"] as const) {
      router.get(`/:launchpadId/${resource}`, async (request,response,next) => {
        try {
          const id = launchpadId.parse(request.params.launchpadId);
          const take = limit.parse(request.query.limit);
          response.json(await (resource === "tokens" ? readService.tokens(id,take) : resource === "trades" ? readService.trades(id,take) : readService.graduations(id,take)));
        } catch (error) { next(error); }
      });
    }
    router.get("/:launchpadId/fees", async (request,response,next) => {
      try { response.json(await readService.fees(launchpadId.parse(request.params.launchpadId))); } catch (error) { next(error); }
    });
    router.post("/:launchpadId/quote", async (request,response,next) => {
      try {
        const input = z.object({
          pool: z.string().regex(/^0x[\da-f]{40}$/iu).transform((value) => value.toLowerCase() as `0x${string}`),
          side: z.enum(["buy","sell"]),
          amountRaw: z.string().regex(/^[1-9]\d*$/u).transform(BigInt),
        }).strict().parse(request.body);
        response.json(await readService.quote(launchpadId.parse(request.params.launchpadId),input.pool,input.side,input.amountRaw));
      } catch (error) { next(error); }
    });
  }
  router.get("/configuration", (_request, response) => {
    response.json(service.configuration());
  });
  router.get("/presets", async (_request, response, next) => {
    try {
      response.json(await service.approvedPresets());
    } catch (error) {
      next(error);
    }
  });
  router.get("/records", async (request, response, next) => {
    try {
      const owner = z
        .string()
        .transform((value, context) => {
          try {
            return getAddress(value);
          } catch {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid owner",
            });
            return z.NEVER;
          }
        })
        .parse(request.query.owner);
      response.json(await service.ownedLaunchpads(owner));
    } catch (error) {
      next(error);
    }
  });
  router.get("/records/:launchpadId", async (request, response, next) => {
    try {
      const id = z
        .string()
        .regex(/^[1-9]\d*$/u)
        .transform(BigInt)
        .parse(request.params.launchpadId);
      response.json(await service.launchpad(id));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
