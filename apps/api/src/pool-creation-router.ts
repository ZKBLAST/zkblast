import { Router } from "express";
import type { PoolCreationService } from "./pool-creation-service.js";

export function createPoolCreationRouter(service: PoolCreationService) {
  const router = Router();
  router.post("/prepare", async (request, response) => {
    try {
      response.json(await service.prepare(request.body));
    } catch {
      response
        .status(400)
        .json({ error: { code: "POOL_CREATION_VALIDATION_FAILED" } });
    }
  });
  return router;
}
