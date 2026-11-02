import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import {
  privateVaultV2ConfigSchema,
  privateV2ConfigIssue,
  type PrivateVaultV2Config,
  privatePerpsConfigSchema,
  type PrivatePerpsConfig,
} from "@zkblast/config";
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
import type { PoolCreationService } from "./pool-creation-service.js";
import { createPoolCreationRouter } from "./pool-creation-router.js";
import { createDbcRouter } from "./dbc-router.js";
import type { DbcService } from "./dbc-service.js";
import { createPerpsRouter } from "./perps-router.js";
import type { PerpsService } from "./perps-service.js";
import { createLaunchpadBrandingRouter } from "./launchpad-branding-router.js";
import type { LaunchpadBrandingService } from "./launchpad-branding-service.js";
import { createLaunchpadDomainRouter } from "./launchpad-domain-router.js";
import type { LaunchpadDomainService } from "./launchpad-domain-service.js";
import { createLaunchpadCatalogRouter } from "./launchpad-catalog-router.js";
import type { LaunchpadCatalogService } from "./launchpad-catalog-service.js";
import type { LaunchpadReadService } from "./launchpad-read-service.js";
import { createLaunchpadDeveloperRouter } from "./launchpad-developer-router.js";
import type { LaunchpadDeveloperService } from "./launchpad-developer-service.js";

export type ApiPublicConfig = Readonly<{
  shieldedV2?: PrivateVaultV2Config;
  perps?: PrivatePerpsConfig;
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
  webOrigin: string;
  operationsToken?: string;
  contracts?: readonly Readonly<{
    name: string;
    proxyKind: "uups" | "none";
    address: string;
    proxyAddress: string | null;
    implementationAddress: string;
    verification: Readonly<{
      implementation: "pending" | "verified" | "failed";
      proxy: "pending" | "verified" | "failed" | "not_applicable";
      urls: readonly string[];
    }>;
  }>[];
  shielded?: Readonly<{
    launchMode?: "independent-reviewed" | "experimental-single-operator";
    proverRelease?: Readonly<{ manifestPath: string; manifestSha256: string }>;
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

const publicConfigResponseSchema = z
  .object({
    shieldedV2: privateVaultV2ConfigSchema.optional(),
    perps: privatePerpsConfigSchema.optional(),
    environment: z.enum(["testnet", "mainnet"]),
    chainId: z.number().int().positive(),
    chainName: z.string().min(1),
    explorerUrl: z.string().url(),
    contracts: z
      .array(
        z.object({
          name: z.string().min(1),
          proxyKind: z.enum(["uups", "none"]),
          address: z.string().regex(/^0x[\da-f]{40}$/iu),
          proxyAddress: z
            .string()
            .regex(/^0x[\da-f]{40}$/iu)
            .nullable(),
          implementationAddress: z.string().regex(/^0x[\da-f]{40}$/iu),
          verification: z.object({
            implementation: z.enum(["pending", "verified", "failed"]),
            proxy: z.enum(["pending", "verified", "failed", "not_applicable"]),
            urls: z.array(z.string().url()),
          }),
        }),
      )
      .optional(),
    shielded: z
      .object({
        launchMode: z
          .enum(["independent-reviewed", "experimental-single-operator"])
          .optional(),
        proverRelease: z
          .object({
            manifestPath: z
              .string()
              .regex(/^\/zk\/(?:testnet|mainnet)\/[a-zA-Z0-9_-]+\.json$/u),
            manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .optional(),
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
  })
  .superRefine((value, context) => {
    if (
      value.shieldedV2 &&
      privateV2ConfigIssue(
        value.environment,
        value.chainId,
        value.shieldedV2,
        value.shielded?.vaultAddress,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shieldedV2"],
        message: privateV2ConfigIssue(
          value.environment,
          value.chainId,
          value.shieldedV2,
          value.shielded?.vaultAddress,
        )!,
      });
    }
    const expected = value.environment === "testnet" ? 46_630 : 4_663;
    if (value.chainId !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chainId"],
        message: `${value.environment} requires chain ${expected}`,
      });
    }
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
    shieldedV2Service?: ShieldedService;
    externalMarketService?: ExternalMarketService;
    tradeReceiptService?: TradeReceiptService;
    poolCreationService?: PoolCreationService;
    perpsService?: PerpsService;
    dbcService?: DbcService;
    launchpadBrandingService?: LaunchpadBrandingService;
    launchpadDomainService?: LaunchpadDomainService;
    launchpadCatalogService?: LaunchpadCatalogService;
    launchpadReadService?: LaunchpadReadService;
    launchpadDeveloperService?: LaunchpadDeveloperService;
  }> = {},
) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.webOrigin,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["content-type", "x-request-id", "x-zkblast-api-key"],
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
  app.use(express.json({ limit: "600kb", strict: true }));

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
      contracts: config.contracts,
      shielded: config.shielded,
      shieldedV2: config.shieldedV2,
      perps: config.perps,
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
        config.operationsToken,
      ),
    );
  }
  if (dependencies.shieldedService) {
    app.use("/v1/shielded", createShieldedRouter(dependencies.shieldedService));
  }
  if (dependencies.shieldedV2Service) {
    app.use(
      "/v1/shielded-v2",
      createShieldedRouter(dependencies.shieldedV2Service, true),
    );
  }
  if (dependencies.poolCreationService)
    app.use(
      "/v1/protocol/pool-creation",
      createPoolCreationRouter(dependencies.poolCreationService),
    );
  if (dependencies.externalMarketService) {
    app.use(
      "/v1/markets",
      createExternalMarketRouter(
        dependencies.externalMarketService,
        dependencies.swapService,
      ),
    );
  }
  if (dependencies.perpsService) {
    app.use("/v1/perps", createPerpsRouter(dependencies.perpsService));
  }
  if (dependencies.dbcService) {
    app.use("/v1/dbc", createDbcRouter(dependencies.dbcService));
  }
  if (dependencies.launchpadCatalogService) {
    app.use(
      "/v1/launchpads",
      createLaunchpadCatalogRouter(
        dependencies.launchpadCatalogService,
        dependencies.launchpadReadService,
        dependencies.launchpadBrandingService,
      ),
    );
  }
  if (dependencies.launchpadBrandingService) {
    app.use(
      "/v1/launchpads",
      createLaunchpadBrandingRouter(dependencies.launchpadBrandingService),
    );
  }
  if (dependencies.launchpadDomainService) {
    app.use(
      "/v1/launchpads",
      createLaunchpadDomainRouter(dependencies.launchpadDomainService),
    );
  }
  if (dependencies.launchpadDeveloperService) {
    app.use(
      "/v1/launchpads",
      createLaunchpadDeveloperRouter(dependencies.launchpadDeveloperService),
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
    const unknownError: unknown = error;
    const internalCode =
      unknownError && typeof unknownError === "object" && "code" in unknownError
        ? String(unknownError.code)
        : "UNCLASSIFIED";
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
    const commitmentMissing =
      error instanceof Error && error.message === "COMMITMENT_NOT_FOUND";
    const databaseCapacity =
      error instanceof Error && error.message.includes("EMAXCONNSESSION");
    const perpsUnavailable =
      error instanceof Error &&
      ["PERPS_NOT_DEPLOYED", "PERP_MARKET_UNAVAILABLE"].includes(error.message);
    const perpsRequestConflict =
      error instanceof Error &&
      ["PERP_RISK_LIMIT", "PERP_INVALID_DEADLINE"].includes(error.message);
    const perpsRelayMissing =
      error instanceof Error &&
      error.message === "PERPS_RELAY_REQUEST_NOT_FOUND";
    const perpsRelayPreflight =
      error instanceof Error &&
      [
        "STALE_ORACLE_PRICE",
        "PRICE_LIMIT_EXCEEDED",
        "PERPS_RELAY_SIMULATION_FAILED",
      ].includes(error.message);
    const launchpadNotFound =
      error instanceof Error &&
      ["LAUNCHPAD_NOT_FOUND", "LAUNCHPAD_POOL_NOT_BOUND"].includes(
        error.message,
      );
    const launchpadConflict =
      error instanceof Error && error.message === "LAUNCHPAD_POOL_NOT_TRADABLE";
    const launchpadUnavailable =
      error instanceof Error && error.message === "LAUNCHPAD_QUOTE_UNAVAILABLE";
    const dbcNotFound =
      error instanceof Error && error.message === "DBC_POOL_NOT_FOUND";
    const dbcConflict =
      error instanceof Error && error.message === "DBC_CURVE_TRADING_CLOSED";
    const launchpadRequestError =
      error instanceof Error && error.message.startsWith("LAUNCHPAD_");
    const launchpadApiAuthentication =
      error instanceof Error && error.message === "LAUNCHPAD_API_KEY_INVALID";
    const status = invalidRequest
      ? 400
      : authenticationFailure
        ? 401
        : usernameConflict
          ? 409
          : commitmentMissing
            ? 404
            : perpsRelayMissing
              ? 404
              : perpsRelayPreflight
                ? 409
                : launchpadNotFound
                  ? 404
                  : launchpadConflict
                    ? 409
                    : dbcNotFound
                      ? 404
                      : dbcConflict
                        ? 409
                        : launchpadUnavailable
                          ? 503
                          : launchpadApiAuthentication
                            ? 401
                            : launchpadRequestError
                              ? 400
                              : databaseCapacity || perpsUnavailable
                                ? 503
                                : perpsRequestConflict
                                  ? 409
                                  : 500;
    if (status === 500) {
      console.error(
        JSON.stringify({
          event: "request_error",
          code: internalCode,
          category:
            internalCode === "XX000" || internalCode === "EMAXCONNSESSION"
              ? "database_capacity"
              : "internal",
        }),
      );
    }
    response.status(status).json({
      error: {
        code: invalidRequest
          ? "INVALID_REQUEST"
          : authenticationFailure
            ? "AUTHENTICATION_FAILED"
            : usernameConflict
              ? "USERNAME_TAKEN"
              : commitmentMissing
                ? "COMMITMENT_NOT_FOUND"
                : perpsRelayMissing
                  ? "PERPS_RELAY_REQUEST_NOT_FOUND"
                  : perpsRelayPreflight
                    ? error instanceof Error
                      ? error.message
                      : "PERPS_RELAY_SIMULATION_FAILED"
                    : launchpadNotFound ||
                        launchpadConflict ||
                        launchpadUnavailable ||
                        dbcNotFound ||
                        dbcConflict
                      ? error instanceof Error
                        ? error.message
                        : "LAUNCHPAD_REQUEST_FAILED"
                      : launchpadRequestError
                        ? error instanceof Error
                          ? error.message
                          : "LAUNCHPAD_REQUEST_INVALID"
                        : databaseCapacity
                          ? "TEMPORARILY_UNAVAILABLE"
                          : perpsUnavailable
                            ? error instanceof Error
                              ? error.message
                              : "PERPS_UNAVAILABLE"
                            : perpsRequestConflict
                              ? error instanceof Error
                                ? error.message
                                : "PERP_REQUEST_CONFLICT"
                              : "INTERNAL_ERROR",
      },
    });
  };
  app.use(errorHandler);

  return app;
}
