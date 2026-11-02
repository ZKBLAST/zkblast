import { Router } from "express";
import { launchpadSlugSchema } from "@zkblast/database";
import { z } from "zod";
import type { Hex } from "viem";
import type { LaunchpadBrandingService } from "./launchpad-branding-service.js";
import rateLimit from "express-rate-limit";

const publishRequest = z.object({
  branding: z.unknown(),
  version: z.number().int().positive(),
  ownerAddress: z.string(),
  signature: z.string().regex(/^0x[\da-f]{130}$/iu),
  signedAt: z.string().datetime(),
  logo: z.object({ mime: z.string(), base64: z.string().max(350_000) }).nullable(),
  favicon: z.object({ mime: z.string(), base64: z.string().max(90_000) }).nullable(),
}).strict();

export function createLaunchpadBrandingRouter(service: LaunchpadBrandingService) {
  const router = Router();
  const mutationLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  router.post("/branding", mutationLimit, async (request, response, next) => {
    try {
      const input = publishRequest.parse(request.body);
      const record = await service.publish({
        branding: input.branding,
        version: input.version,
        ownerAddress: input.ownerAddress,
        signature: input.signature as Hex,
        signedAt: input.signedAt,
        logo: input.logo,
        favicon: input.favicon,
      });
      response.status(201).json({
        launchpadId: record.branding.launchpadId,
        slug: record.branding.slug,
        version: record.version,
        metadataHash: record.metadataHash,
      });
    } catch (error) { next(error); }
  });
  router.get("/:slug", async (request, response, next) => {
    try {
      const slug = launchpadSlugSchema.parse(request.params.slug);
      const record = await service.bySlug(slug);
      if (!record) return response.status(404).json({ error: { code: "LAUNCHPAD_NOT_FOUND" } });
      return response.json({
        ...record.branding,
        version: record.version,
        metadataHash: record.metadataHash,
        logoUrl: record.logo ? `/v1/launchpads/${slug}/logo` : null,
        faviconUrl: record.favicon ? `/v1/launchpads/${slug}/favicon` : null,
        protocol: "ZKBLAST",
      });
    } catch (error) { next(error); return undefined; }
  });
  for (const kind of ["logo", "favicon"] as const) {
    router.get(`/:slug/${kind}`, async (request, response, next) => {
      try {
        const record = await service.bySlug(launchpadSlugSchema.parse(request.params.slug));
        const image = record?.[kind];
        if (!image) return response.status(404).end();
        response.set({
          "content-type": image.mime,
          "content-length": image.bytes.byteLength.toString(),
          "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        });
        return response.send(Buffer.from(image.bytes));
      } catch (error) { next(error); return undefined; }
    });
  }
  return router;
}
