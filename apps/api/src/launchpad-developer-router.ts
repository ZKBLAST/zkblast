import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Hex } from "viem";
import { ApiKeyRateGuard,launchpadApiScopes,launchpadWebhookEvents } from "./launchpad-developer-security.js";
import type { LaunchpadDeveloperService } from "./launchpad-developer-service.js";

const auth = z.object({ ownerAddress: z.string().regex(/^0x[\da-f]{40}$/iu),signature: z.string().regex(/^0x[\da-f]{130}$/iu),signedAt: z.string().datetime() }).strict();
const id = z.string().uuid();
const launchpadId = z.string().regex(/^[1-9]\d*$/u);
const authorized = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape,authorization: auth }).strict();
export function createLaunchpadDeveloperRouter(service: LaunchpadDeveloperService) {
  const router = Router();
  const limit = rateLimit({ windowMs: 60_000,limit: 10,standardHeaders: "draft-7",legacyHeaders: false });
  const keyLimit = new ApiKeyRateGuard(60,60_000);
  const authorization = (value: z.infer<typeof auth>) => ({ ...value,signature: value.signature as Hex });
  router.post("/:launchpadId/developer/api-keys",limit,async (request,response,next) => { try {
    const input=authorized({ name: z.string().trim().min(1).max(80),scopes: z.array(z.enum(launchpadApiScopes)).min(1).max(16) }).parse(request.body);
    response.status(201).json(await service.createKey(launchpadId.parse(request.params.launchpadId),{ name: input.name,scopes: input.scopes },authorization(input.authorization)));
  } catch(error){next(error);} });
  router.post("/:launchpadId/developer/api-keys/:keyId/rotate",limit,async (request,response,next) => { try { const input=authorized({}).parse(request.body); response.json(await service.rotateKey(launchpadId.parse(request.params.launchpadId),id.parse(request.params.keyId),authorization(input.authorization))); } catch(error){next(error);} });
  router.delete("/:launchpadId/developer/api-keys/:keyId",limit,async (request,response,next) => { try { const input=authorized({}).parse(request.body); await service.revokeKey(launchpadId.parse(request.params.launchpadId),id.parse(request.params.keyId),authorization(input.authorization)); response.status(204).end(); } catch(error){next(error);} });
  router.post("/:launchpadId/developer/webhooks",limit,async (request,response,next) => { try {
    const input=authorized({ url: z.string().url().max(2048),eventTypes: z.array(z.enum(launchpadWebhookEvents)).min(1).max(16) }).parse(request.body);
    response.status(201).json(await service.registerWebhook(launchpadId.parse(request.params.launchpadId),{ url: input.url,eventTypes: input.eventTypes },authorization(input.authorization)));
  } catch(error){next(error);} });
  router.post("/:launchpadId/developer/webhooks/:endpointId/verify",limit,async (request,response,next) => { try { const input=authorized({ verificationToken: z.string().min(32).max(128) }).parse(request.body); await service.verifyWebhook(launchpadId.parse(request.params.launchpadId),id.parse(request.params.endpointId),input.verificationToken,authorization(input.authorization)); response.json({ status: "active" }); } catch(error){next(error);} });
  router.post("/:launchpadId/developer/deliveries/:deliveryId/retry",limit,async (request,response,next) => { try { const input=authorized({}).parse(request.body); await service.retryDelivery(launchpadId.parse(request.params.launchpadId),id.parse(request.params.deliveryId),authorization(input.authorization)); response.status(202).json({ status: "pending" }); } catch(error){next(error);} });
  router.post("/:launchpadId/developer/snapshot",limit,async (request,response,next) => { try { const input=authorized({}).parse(request.body); response.json(await service.snapshot(launchpadId.parse(request.params.launchpadId),authorization(input.authorization))); } catch(error){next(error);} });
  router.get("/:launchpadId/developer/api/status",async (request,response,next) => { try {
    const value=request.header("x-zkblast-api-key") ?? "";
    const key=await service.authenticateApiKey(value,"launchpads:read");
    if (key.launchpadId!==launchpadId.parse(request.params.launchpadId)) throw new Error("LAUNCHPAD_API_KEY_INVALID");
    const usage=keyLimit.consume(key.prefix);
    response.setHeader("x-ratelimit-remaining",usage.remaining.toString());
    response.setHeader("x-ratelimit-reset",Math.ceil(usage.resetsAt/1000).toString());
    await service.recordApiKeyUse(key.keyId,!usage.allowed);
    if (!usage.allowed) return response.status(429).json({ error: { code: "LAUNCHPAD_API_KEY_RATE_LIMITED" } });
    return response.json({ status: "ok",launchpadId: key.launchpadId,scopes: key.scopes });
  } catch(error){next(error);} });
  return router;
}
