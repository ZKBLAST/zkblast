import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { createAuthRouter } from "./auth-router.js";
import type { AuthService } from "./auth-service.js";
import { createIdentityRouter } from "./identity-router.js";
import type { IdentityService } from "./identity-service.js";
import { createProtocolRouter } from "./protocol-router.js";
import type { ProtocolService } from "./protocol-service.js";
import type { SwapService } from "./swap-service.js";
import type { LiquidityService } from "./liquidity-service.js";
import type { OperationsService } from "./operations-service.js";
import { createShieldedRouter } from "./shielded-router.js";
import type { ShieldedService } from "./shielded-service.js";
import { createExternalMarketRouter } from "./external-market-router.js";
import type { ExternalMarketService } from "./external-market-service.js";
import type { TradeReceiptService } from "./trade-receipt-service.js";

export type ApiPublicConfig = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
  webOrigin: string;
  shielded?: Readonly<{
    vaultAddress: string;
    stateRegistryAddress: string;
    treeVersion: number;
    assets: readonly Readonly<{
      address: string;
      symbol: string;
      decimals: number;
      denominationRaw: string;
    }>[];
  }>;
}>;

const publicConfigResponseSchema = z.object({
  environment: z.enum(["testnet", "mainnet"]),
  chainId: z.number().int().positive(),
  chainName: z.string().min(1),
  explorerUrl: z.string().url(),
  shielded: z
    .object({
      vaultAddress: z.string().regex(/^0x[\da-f]{40}$/iu),
      stateRegistryAddress: z.string().regex(/^0x[\da-f]{40}$/iu),
      treeVersion: z.number().int().positive(),
      assets: z.array(
        z.object({
          address: z.string().regex(/^0x[\da-f]{40}$/iu),
          symbol: z.string().min(1),
          decimals: z.number().int().min(0).max(255),
          denominationRaw: z.string().regex(/^[1-9]\d*$/u),
        }),
      ),
    })
    .optional(),
});

export function createApp(
  config: ApiPublicConfig,
  dependencies: Readonly<{
    authService?: AuthService;
    identityService?: IdentityService;
    protocolService?: ProtocolService;
    swapService?: SwapService;
    liquidityService?: LiquidityService;
    operationsService?: OperationsService;
    shieldedService?: ShieldedService;
    externalMarketService?: ExternalMarketService;
    tradeReceiptService?: TradeReceiptService;
  }> = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.webOrigin,
      methods: ["GET", "POST", "PATCH"],
      allowedHeaders: ["content-type", "x-request-id"],
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/ready", async (_request, response, next) => {
    try {
      if (!dependencies.protocolService)
        return response.status(503).json({ ready: false });
      const readiness = await dependencies.protocolService.readiness();
      return response.status(readiness.ready ? 200 : 503).json(readiness);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/v1/config", (_request, response) => {
    const body = publicConfigResponseSchema.parse({
      environment: config.environment,
      chainId: config.chainId,
      chainName: config.chainName,
      explorerUrl: config.explorerUrl,
      shielded: config.shielded,
    });
    response.json(body);
  });

  if (dependencies.authService) {
    app.use("/v1/auth", createAuthRouter(dependencies.authService));
  }
  if (dependencies.identityService) {
    app.use(
      "/v1",
      createIdentityRouter(
        dependencies.identityService,
        dependencies.tradeReceiptService,
      ),
    );
  }
  if (dependencies.protocolService) {
    app.use(
      "/v1/protocol",
      createProtocolRouter(
        dependencies.protocolService,
        dependencies.swapService,
        dependencies.liquidityService,
        dependencies.operationsService,
      ),
    );
  }
  if (dependencies.shieldedService) {
    app.use("/v1/shielded", createShieldedRouter(dependencies.shieldedService));
  }
  if (dependencies.externalMarketService) {
    app.use(
      "/v1/markets",
      createExternalMarketRouter(
        dependencies.externalMarketService,
        dependencies.swapService,
      ),
    );
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND" } });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    void _next;
    const invalidRequest =
      error instanceof SyntaxError || error instanceof z.ZodError;
    const authenticationFailure =
      error instanceof Error &&
      [
        "INVALID_LOGIN_MESSAGE",
        "INVALID_WALLET_SIGNATURE",
        "INVALID_OR_EXPIRED_CHALLENGE",
        "UNAUTHENTICATED",
      ].includes(error.message);
    const usernameConflict =
      error instanceof Error && error.message === "USERNAME_TAKEN";
    const status = invalidRequest
      ? 400
      : authenticationFailure
        ? 401
        : usernameConflict
          ? 409
          : 500;
    response.status(status).json({
      error: {
        code: invalidRequest
          ? "INVALID_REQUEST"
          : authenticationFailure
            ? "AUTHENTICATION_FAILED"
            : usernameConflict
              ? "USERNAME_TAKEN"
              : "INTERNAL_ERROR",
      },
    });
  };
  app.use(errorHandler);

  return app;
}
