import { Router } from "express";
import { z } from "zod";
import type { PerpsService } from "./perps-service.js";

const positionsQuery = z.object({
  ownerCommitment: z.string().regex(/^0x[\da-f]{64}$/iu).optional(),
  ownerAddress: z.string().regex(/^0x[\da-f]{40}$/iu).optional(),
});
const activityQuery = z.object({
  ownerAddress: z.string().regex(/^0x[\da-f]{40}$/iu).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().regex(/^\d+:\d+$/u).optional(),
});
const modifyQuoteQuery = z.object({ leverageBps: z.coerce.number().int().min(10_000).max(100_000) });
const bytes32 = z.string().regex(/^0x[\da-f]{64}$/iu);
const unsigned = z.string().regex(/^\d+$/u);
const chartQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
}).refine((value) => value.to > value.from, { message: "to must be after from" })
  .refine((value) => value.to.getTime() - value.from.getTime() <= 31 * 86_400_000, {
    message: "chart range cannot exceed 31 days",
  });
const openBody = z.object({
  positionId: bytes32,
  ownerCommitment: bytes32,
  marketId: bytes32,
  marginRaw: unsigned,
  leverageBps: z.number().int().min(10_000).max(100_000),
  acceptablePriceX18: unsigned,
  deadline: unsigned,
  isLong: z.boolean(),
}).strict();
const closeBody = z.object({
  positionId: bytes32,
  payoutCommitment: bytes32,
  acceptablePriceX18: unsigned,
  deadline: unsigned,
  recipient: z.string().regex(/^0x[\da-f]{40}$/iu),
}).strict();
const privateRelayBody = z.object({
  action: z.enum(["open", "close", "modify", "claim-liquidated"]),
  proof: z.string().regex(/^0x[0-9a-f]{512}$/iu),
  publicInputs: z.array(unsigned).min(15).max(21),
}).strict();

export function createPerpsRouter(service: PerpsService) {
  const router = Router();
  router.get("/markets", async (_request, response, next) => {
    try {
      response.json({ items: await service.markets() });
    } catch (error) {
      next(error);
    }
  });
  router.get("/markets/:marketId/chart", async (request, response, next) => {
    try {
      const marketId = bytes32.parse(request.params.marketId);
      const query = chartQuery.parse(request.query);
      response.json({
        marketId,
        source: "oracle",
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        items: await service.oracleHistory(marketId, query),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/markets/:marketId/price", async (request, response, next) => {
    try {
      response.json(await service.currentOraclePrice(
        bytes32.parse(request.params.marketId) as `0x${string}`,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.get("/catalog", async (_request, response, next) => {
    try {
      response.json({ items: await service.marketCatalog() });
    } catch (error) {
      next(error);
    }
  });
  router.get("/positions", async (request, response, next) => {
    try {
      const query = positionsQuery.parse(request.query);
      response.json({ items: await service.positions(query.ownerCommitment, query.ownerAddress) });
    } catch (error) {
      next(error);
    }
  });
  router.get("/positions/:positionId/live", async (request, response, next) => {
    try {
      response.json(await service.livePosition(
        bytes32.parse(request.params.positionId) as `0x${string}`,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.get("/vault", async (_request, response, next) => {
    try {
      response.json({ vault: await service.vault() });
    } catch (error) {
      next(error);
    }
  });
  router.get("/quote/close/:positionId", async (request, response, next) => {
    try {
      response.json(await service.closeQuote(bytes32.parse(request.params.positionId) as `0x${string}`));
    } catch (error) {
      next(error);
    }
  });
  router.get("/quote/modify/:positionId", async (request, response, next) => {
    try {
      const query = modifyQuoteQuery.parse(request.query);
      response.json(await service.modifyQuote(
        bytes32.parse(request.params.positionId) as `0x${string}`,
        query.leverageBps,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.get("/private/residual/:positionId", async (request, response, next) => {
    try {
      response.json(await service.residual(bytes32.parse(request.params.positionId) as `0x${string}`));
    } catch (error) {
      next(error);
    }
  });
  router.get("/activity", async (request, response, next) => {
    try {
      const query = activityQuery.parse(request.query);
      const [block, logIndex] = query.cursor?.split(":") ?? [];
      response.json(await service.activity({
        limit: query.limit,
        ...(query.ownerAddress ? { ownerAddress: query.ownerAddress } : {}),
        ...(block && logIndex
          ? { cursorBlock: BigInt(block), cursorLogIndex: Number(logIndex) }
          : {}),
      }));
    } catch (error) {
      next(error);
    }
  });
  router.post("/prepare/open", async (request, response, next) => {
    try {
      const body = openBody.parse(request.body);
      response.json(await service.prepareOpen({
        ...body,
        positionId: body.positionId as `0x${string}`,
        ownerCommitment: body.ownerCommitment as `0x${string}`,
        marketId: body.marketId as `0x${string}`,
        marginRaw: BigInt(body.marginRaw),
        acceptablePriceX18: BigInt(body.acceptablePriceX18),
        deadline: BigInt(body.deadline),
      }));
    } catch (error) {
      next(error);
    }
  });
  router.post("/prepare/close", (request, response, next) => {
    try {
      const body = closeBody.parse(request.body);
      response.json(service.prepareClose({
        positionId: body.positionId as `0x${string}`,
        payoutCommitment: body.payoutCommitment as `0x${string}`,
        acceptablePriceX18: BigInt(body.acceptablePriceX18),
        deadline: BigInt(body.deadline),
        recipient: body.recipient as `0x${string}`,
      }));
    } catch (error) {
      next(error);
    }
  });
  router.post("/private/relay", async (request, response, next) => {
    try {
      const body = privateRelayBody.parse(request.body);
      response.status(202).json(await service.enqueuePrivateRelay({
        action: body.action,
        proof: body.proof as `0x${string}`,
        publicInputs: body.publicInputs.map(BigInt),
      }));
    } catch (error) {
      next(error);
    }
  });
  router.get("/private/relay/:requestId", async (request, response, next) => {
    try {
      response.json(await service.privateRelayStatus(bytes32.parse(request.params.requestId) as `0x${string}`));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
