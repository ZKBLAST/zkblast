import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "./auth-service.js";

const challengeBodySchema = z.object({ walletAddress: z.string() }).strict();
const verifyBodySchema = z
  .object({
    challengeId: z.string(),
    walletAddress: z.string(),
    message: z.string().max(2_048),
    signature: z.string(),
  })
  .strict();

export function createAuthRouter(authService: AuthService) {
  const router = Router();

  router.post("/challenge", async (request, response, next) => {
    try {
      const body = challengeBodySchema.parse(request.body);
      response
        .status(201)
        .json(await authService.createChallenge(body.walletAddress));
    } catch (error) {
      next(error);
    }
  });

  router.post("/verify", async (request, response, next) => {
    try {
      const body = verifyBodySchema.parse(request.body);
      const session = await authService.verifyChallenge(body);
      response.setHeader(
        "set-cookie",
        `zkblast_session=${session.sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${session.expiresAt.toUTCString()}`,
      );
      response.json({
        userId: session.userId,
        walletId: session.walletId,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
