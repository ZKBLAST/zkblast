import { Router, type Request } from "express";
import { z } from "zod";
import type { IdentityService } from "./identity-service.js";

const usernameBodySchema = z.object({ username: z.string() }).strict();
const tradeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().datetime().optional(),
});

function readSessionCookie(request: Request): string {
  const cookieHeader = request.headers.cookie ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("zkblast_session="));
  if (!sessionCookie) throw new Error("UNAUTHENTICATED");
  return decodeURIComponent(sessionCookie.slice("zkblast_session=".length));
}

export function createIdentityRouter(identityService: IdentityService) {
  const router = Router();

  router.post("/auth/logout", async (request, response, next) => {
    try {
      await identityService.logout(readSessionCookie(request));
      response.setHeader(
        "set-cookie",
        "zkblast_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", async (request, response, next) => {
    try {
      const identity = await identityService.authenticate(
        readSessionCookie(request),
      );
      response.json(await identityService.getProfile(identity.userId));
    } catch (error) {
      next(error);
    }
  });

  router.patch("/me/username", async (request, response, next) => {
    try {
      const identity = await identityService.authenticate(
        readSessionCookie(request),
      );
      const body = usernameBodySchema.parse(request.body);
      response.json(
        await identityService.updateUsername(identity.userId, body.username),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/me/trades", async (request, response, next) => {
    try {
      const identity = await identityService.authenticate(
        readSessionCookie(request),
      );
      const query = tradeQuerySchema.parse(request.query);
      response.json({
        items: await identityService.getTradeHistory(identity.userId, query),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
