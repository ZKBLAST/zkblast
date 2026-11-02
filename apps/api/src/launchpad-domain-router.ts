import { Router } from "express";
import { z } from "zod";
import type { Hex } from "viem";
import type { LaunchpadDomainService } from "./launchpad-domain-service.js";
import rateLimit from "express-rate-limit";

const authorization = z.object({
  ownerAddress: z.string(),
  signature: z.string().regex(/^0x[\da-f]{130}$/iu),
  signedAt: z.string().datetime(),
}).strict();
const issue = authorization.extend({
  launchpadId: z.string().regex(/^[1-9]\d*$/u),
  hostname: z.string().min(4).max(253),
}).strict();
const domainId = z.string().uuid();

export function createLaunchpadDomainRouter(service: LaunchpadDomainService) {
  const router = Router();
  const mutationLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
  router.post("/domains/challenge", mutationLimit, async (request, response, next) => {
    try {
      const input = issue.parse(request.body);
      const result = await service.issue({ ...input, signature: input.signature as Hex });
      response.status(201).json({
        domainId: result.domainId,
        hostname: result.hostname,
        status: result.status,
        recordType: "TXT",
        recordName: result.recordName,
        recordValue: result.challenge,
        expiresAt: result.challengeExpiresAt.toISOString(),
      });
    } catch (error) { next(error); }
  });
  router.post("/domains/:domainId/verify", mutationLimit, async (request, response, next) => {
    try {
      const input = authorization.parse(request.body);
      const result = await service.verify({
        domainId: domainId.parse(request.params.domainId),
        ...input,
        signature: input.signature as Hex,
      });
      response.json({ domainId: result.domainId, hostname: result.hostname, status: result.status, verifiedAt: result.verifiedAt?.toISOString() });
    } catch (error) { next(error); }
  });
  router.delete("/domains/:domainId", mutationLimit, async (request, response, next) => {
    try {
      const input = authorization.parse(request.body);
      const result = await service.revoke({
        domainId: domainId.parse(request.params.domainId),
        ...input,
        signature: input.signature as Hex,
      });
      response.json({ domainId: result.domainId, hostname: result.hostname, status: result.status, revokedAt: result.revokedAt?.toISOString() });
    } catch (error) { next(error); }
  });
  return router;
}
