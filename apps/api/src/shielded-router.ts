import { Router } from "express";
import { z } from "zod";
import type { Hex } from "viem";
import type { ShieldedService } from "./shielded-service.js";

const commitmentSchema = z.string().regex(/^0x[0-9a-f]{64}$/iu);

export function createShieldedRouter(service: ShieldedService): Router {
  const router = Router();
  router.get("/path/:commitment", async (request, response, next) => {
    try {
      response.json(
        await service.path(
          commitmentSchema.parse(request.params.commitment) as Hex,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}
