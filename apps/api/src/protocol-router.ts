import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { ProtocolService } from "./protocol-service.js";
import type { SwapService } from "./swap-service.js";
import type { LiquidityService } from "./liquidity-service.js";
import type { OperationsHealthService } from "./operations-service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
  owner: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u)
    .transform((value) => value.toLowerCase())
    .optional(),
});
const poolTradeQuerySchema = querySchema.extend({
  cursor: z
    .string()
    .regex(/^\d+:0x[\da-fA-F]{64}:\d+$/u)
    .optional(),
});
const dlmmBinQuerySchema = z
  .object({
    lower: z.coerce.number().int().min(-10_000).max(10_000).optional(),
    upper: z.coerce.number().int().min(-10_000).max(10_000).optional(),
    skipEmpty: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  })
  .refine(
    ({ lower, upper }) =>
      (lower === undefined && upper === undefined) ||
      (lower !== undefined && upper !== undefined && lower <= upper && upper - lower < 121),
    { message: "Invalid or overly wide DLMM bin range" },
  );

const swapSchema = z
  .object({
    model: z.enum(["damm", "dlmm"]),
    pool: z.string(),
    tokenIn: z.string(),
    amountIn: z.string().regex(/^\d+$/u),
    slippageBps: z.number().int().min(0).max(10_000),
    recipient: z.string(),
    deadline: z.string().regex(/^\d+$/u),
    token0ToToken1: z.boolean().optional(),
    maximumBinCrossings: z.number().int().min(1).max(256).optional(),
  })
  .strict();

const integerString = z.string().regex(/^\d+$/u);
const poolAddressSchema = z.string().regex(/^0x[\da-f]{40}$/iu);
const chartRangeFields = {
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
} as const;
const validChartRange = (q: { from: Date; to: Date }) =>
  q.to > q.from && q.to.getTime() - q.from.getTime() <= 31 * 86400000;
const chartRangeSchema = z.object(chartRangeFields).refine(validChartRange);
const candleQuerySchema = z.object({
  ...chartRangeFields,
  intervalSeconds: z.coerce.number().pipe(z.union([
    z.literal(60),z.literal(300),z.literal(900),z.literal(3600),
    z.literal(14400),z.literal(86400),
  ])),
}).refine(validChartRange);
const poolTradeCursorRowSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/u),
  transactionHash: z.string().regex(/^0x[\da-f]{64}$/iu),
  logIndex: z.coerce.number().int().nonnegative(),
});
const createLiquiditySchema = z
  .object({
    model: z.enum(["damm", "dlmm"]),
    pool: z.string(),
    token0: z.string(),
    token1: z.string(),
    amount0: integerString,
    amount1: integerString,
    minimumShares: integerString,
    deadline: integerString,
    binId: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .strict();
const positionOwnerSchema = z.object({
  owner: z.string(),
  positionId: integerString,
});
const increaseSchema = positionOwnerSchema
  .extend({
    amount0: integerString,
    amount1: integerString,
    minimumShares: integerString,
    deadline: integerString,
  })
  .strict();
const decreaseSchema = positionOwnerSchema
  .extend({
    shares: integerString,
    minimumAmount0: integerString,
    minimumAmount1: integerString,
    recipient: z.string(),
    deadline: integerString,
  })
  .strict();
const transferSchema = positionOwnerSchema
  .extend({ nextOwner: z.string() })
  .strict();
const feeClaimSchema = z
  .object({
    model: z.enum(["damm", "dlmm"]),
    pool: z.string(),
    wallet: z.string(),
  })
  .strict();

export function createProtocolRouter(
  service: ProtocolService,
  swapService?: SwapService,
  liquidityService?: LiquidityService,
  operationsService?: OperationsHealthService,
  operationsToken?: string,
) {
  const router = Router();
  router.get("/pools/:pool/chart", async (request, response, next) => {
    try {
      const pool = poolAddressSchema.parse(request.params.pool);
      const query = chartRangeSchema.parse(request.query);
      response.json({
        pool,
        source: "swap",
        items: await service.priceHistory(pool, query),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/pools/:pool/candles", async (request, response, next) => {
    try {
      const pool = poolAddressSchema.parse(request.params.pool);
      const query = candleQuerySchema.parse(request.query);
      response.json({ pool, source: "swap", items: await service.poolCandles(pool, query) });
    } catch (error) { next(error); }
  });
  router.get("/pools/:pool/stats", async (request, response, next) => {
    try {
      const pool = poolAddressSchema.parse(request.params.pool);
      response.json({ pool, stats: await service.poolStats(pool) });
    } catch (error) { next(error); }
  });
  router.get("/pools/:pool/trades", async (request, response, next) => {
    try {
      const pool = poolAddressSchema.parse(request.params.pool);
      const query = poolTradeQuerySchema.parse(request.query);
      const items = await service.poolTrades(pool, query);
      const last = items.length === query.limit
        ? poolTradeCursorRowSchema.safeParse(items.at(-1))
        : null;
      response.json({
        pool,
        items,
        nextCursor: last?.success
          ? `${last.data.blockNumber}:${last.data.transactionHash.toLowerCase()}:${last.data.logIndex}`
          : null,
      });
    } catch (error) { next(error); }
  });
  router.get("/pools", async (request, response, next) => {
    try {
      response.json({
        items: await service.pools(querySchema.parse(request.query)),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/swaps", async (request, response, next) => {
    try {
      response.json({
        items: await service.swaps(querySchema.parse(request.query)),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/activity", async (request, response, next) => {
    try {
      response.json({
        items: await service.activity(querySchema.parse(request.query)),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/positions", async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      response.json({
        items:
          query.owner && liquidityService
            ? await liquidityService.positionsForOwner(query.owner)
            : await service.positions(query),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/metrics", async (_request, response, next) => {
    try {
      response.json(await service.readiness());
    } catch (error) {
      next(error);
    }
  });
  if (swapService)
    router.post("/swap/quote", async (request, response, next) => {
      try {
        response.json(await swapService.quote(swapSchema.parse(request.body)));
      } catch (error) {
        next(error);
      }
    });
  if (liquidityService) {
    router.get("/pools/:pool/top-lps", async (request, response, next) => {
      try {
        const pool = poolAddressSchema.parse(request.params.pool);
        const limit = z.coerce.number().int().min(1).max(25).default(10).parse(request.query.limit);
        response.json(await liquidityService.topLiquidityProviders(pool, limit));
      } catch (error) {
        next(error);
      }
    });
    router.get("/bins/:pool", async (request, response, next) => {
      try {
        const range = dlmmBinQuerySchema.parse(request.query);
        response.json(
          await liquidityService.dlmmBins(request.params.pool ?? "", range),
        );
      } catch (error) {
        next(error);
      }
    });
    router.post("/liquidity/prepare", async (request, response, next) => {
      try {
        response.json(
          await liquidityService.prepareCreate(
            createLiquiditySchema.parse(request.body),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    router.post("/positions/increase", async (request, response, next) => {
      try {
        response.json(
          await liquidityService.prepareIncrease(
            increaseSchema.parse(request.body),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    router.post("/positions/decrease", async (request, response, next) => {
      try {
        response.json(
          await liquidityService.prepareDecrease(
            decreaseSchema.parse(request.body),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    router.post("/positions/transfer", async (request, response, next) => {
      try {
        response.json(
          await liquidityService.prepareTransfer(
            transferSchema.parse(request.body),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    router.post("/fees/prepare-claim", async (request, response, next) => {
      try {
        response.json(
          await liquidityService.prepareFeeClaim(
            feeClaimSchema.parse(request.body),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    router.get("/accounting/:pool", async (request, response, next) => {
      try {
        const query = z
          .object({ wallet: z.string().optional() })
          .parse(request.query);
        response.json(
          await liquidityService.accounting(
            request.params.pool ?? "",
            query.wallet,
          ),
        );
      } catch (error) {
        next(error);
      }
    });
  }
  if (operationsService) {
    if (!operationsToken || operationsToken.length < 32)
      throw new Error("OPERATIONS_API_TOKEN_REQUIRED");
    router.get("/operations/health", async (request, response, next) => {
      try {
        const authorization = request.header("authorization") ?? "";
        const supplied = authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : "";
        const expectedBytes = Buffer.from(operationsToken);
        const suppliedBytes = Buffer.from(supplied);
        if (
          suppliedBytes.length !== expectedBytes.length ||
          !timingSafeEqual(suppliedBytes, expectedBytes)
        ) {
          return response
            .status(401)
            .json({ error: { code: "OPERATIONS_AUTH_REQUIRED" } });
        }
        const health = await operationsService.health();
        return response
          .status(health.status === "healthy" ? 200 : 503)
          .json(health);
      } catch (error) {
        return next(error);
      }
    });
  }
  return router;
}
