import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import {
  type ChainCapabilities,
  privateVaultV2ConfigSchema,
  privateV2ConfigIssue,
  type PrivateVaultV2Config,
  privatePerpsConfigSchema,
  type PrivatePerpsConfig,
  getChainDescriptor,
  supportedChains,
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
  capabilities?: ChainCapabilities;
  chainAppUrls?: Readonly<Record<number, string>>;
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
    explorerUrl: z.union([z.string().url(), z.literal("")]),
    capabilities: z.object({
      launchpad: z.boolean(),
      dbc: z.boolean(),
      dammGraduation: z.boolean(),
      dlmmGraduation: z.boolean(),
      zkClaimAuthorization: z.boolean(),
      customDomains: z.boolean(),
      metadataUpload: z.boolean(),
    }),
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
    let descriptor;
    try {
      descriptor = getChainDescriptor(value.chainId);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chainId"],
        message: "Unsupported chain",
      });
      return;
    }
    if (value.environment !== descriptor.environment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environment"],
        message: `Chain ${value.chainId} requires ${descriptor.environment}`,
      });
    }
  });

export type ApiDependencies = Readonly<{
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
  }>;

export type ApiChainContext = Readonly<{
  config: ApiPublicConfig;
  dependencies: ApiDependencies;
}>;

export function createApp(
  config: ApiPublicConfig,
  dependencies: ApiDependencies = {},
  additionalChainContexts: readonly ApiChainContext[] = [],
) {
  const app = express();
  const chainContexts = new Map<number, ApiChainContext>([
    [config.chainId, { config, dependencies }],
  ]);
  for (const context of additionalChainContexts) {
    if (chainContexts.has(context.config.chainId))
      throw new Error(`DUPLICATE_CHAIN_CONTEXT:${context.config.chainId}`);
    chainContexts.set(context.config.chainId, context);
  }
  const requireConfiguredChain: RequestHandler = (request, response, next) => {
    const requestedChainId = Number(request.params.chainId);
    try {
      getChainDescriptor(requestedChainId);
    } catch {
      return response
        .status(404)
        .json({ error: { code: "CHAIN_NOT_SUPPORTED" } });
    }
    if (!chainContexts.has(requestedChainId)) {
      return response.status(409).json({
        error: {
          code: "CHAIN_NOT_CONFIGURED",
          configuredChainId: config.chainId,
          configuredChainIds: [...chainContexts.keys()],
        },
      });
    }
    response.setHeader("x-zkblast-chain-id", String(requestedChainId));
    return next();
  };
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

  const publicConfigBody = (chainConfig: ApiPublicConfig) => {
    const descriptor = getChainDescriptor(chainConfig.chainId);
    return publicConfigResponseSchema.parse({
      environment: chainConfig.environment,
      chainId: chainConfig.chainId,
      chainName: chainConfig.chainName,
      explorerUrl: chainConfig.explorerUrl,
      capabilities: descriptor.capabilities,
      contracts: chainConfig.contracts,
      shielded: chainConfig.shielded,
      shieldedV2: chainConfig.shieldedV2,
      perps: chainConfig.perps,
    });
  };

  app.get("/v1/config", (_request, response) => {
    response.json(publicConfigBody(config));
  });

  app.get("/v2/chains", (_request, response) => {
    response.json({
      chains: supportedChains.map((chain) => ({
        chainId: chain.chainId,
        slug: chain.slug,
        family: chain.family,
        environment: chain.environment,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        explorerUrl: chain.explorerUrl,
        capabilities: chain.capabilities,
        configured: chainContexts.has(chain.chainId),
        appUrl: config.chainAppUrls?.[chain.chainId] ?? null,
      })),
    });
  });
  app.use("/v2/chains/:chainId", requireConfiguredChain);

  app.get("/v2/chains/:chainId/config", (request, response) => {
    const context = chainContexts.get(Number(request.params.chainId));
    if (!context)
      return response.status(409).json({ error: { code: "CHAIN_NOT_CONFIGURED" } });
    return response.json(publicConfigBody(context.config));
  });

  app.get("/v2/chains/:chainId/ready", async (request, response, next) => {
    try {
      const context = chainContexts.get(Number(request.params.chainId));
      if (!context?.dependencies.protocolService)
        return response.status(503).json({ ready: false });
      const readiness = await context.dependencies.protocolService.readiness();
      return response.status(readiness.ready ? 200 : 503).json(readiness);
    } catch (error) {
      return next(error);
    }
  });

  const mountChainRouters = (
    path: string,
    createRouter: (context: ApiChainContext) => RequestHandler | undefined,
  ) => {
    const routers = new Map<number, RequestHandler>();
    for (const [chainId, context] of chainContexts) {
      const router = createRouter(context);
      if (router) routers.set(chainId, router);
    }
    app.use(path, (request, response, next) => {
      const chainId = Number(request.params.chainId);
      const router = routers.get(chainId);
      if (!router)
        return response.status(404).json({
          error: { code: "FEATURE_NOT_CONFIGURED", chainId },
        });
      return router(request, response, next);
    });
  };

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
    const createCurrentProtocolRouter = () =>
      createProtocolRouter(
        dependencies.protocolService!,
        dependencies.swapService,
        dependencies.liquidityService,
        dependencies.operationsService,
        config.operationsToken,
      );
    app.use("/v1/protocol", createCurrentProtocolRouter());
  }
  mountChainRouters("/v2/chains/:chainId/protocol", ({ config: chainConfig, dependencies: chainDependencies }) =>
    chainDependencies.protocolService
      ? createProtocolRouter(
          chainDependencies.protocolService,
          chainDependencies.swapService,
          chainDependencies.liquidityService,
          chainDependencies.operationsService,
          chainConfig.operationsToken,
        )
      : undefined,
  );
  mountChainRouters(
    "/v2/chains/:chainId/protocol/pool-creation",
    ({ dependencies: chainDependencies }) =>
      chainDependencies.poolCreationService
        ? createPoolCreationRouter(chainDependencies.poolCreationService)
        : undefined,
  );
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
  mountChainRouters("/v2/chains/:chainId/dbc", ({ dependencies: chainDependencies }) =>
    chainDependencies.dbcService
      ? createDbcRouter(chainDependencies.dbcService)
      : undefined,
  );
  if (dependencies.launchpadCatalogService) {
    const createCurrentLaunchpadCatalogRouter = () =>
      createLaunchpadCatalogRouter(
        dependencies.launchpadCatalogService!,
        dependencies.launchpadReadService,
        dependencies.launchpadBrandingService,
      );
    app.use("/v1/launchpads", createCurrentLaunchpadCatalogRouter());
  }
  if (dependencies.launchpadBrandingService) {
    const createCurrentBrandingRouter = () =>
      createLaunchpadBrandingRouter(dependencies.launchpadBrandingService!);
    app.use("/v1/launchpads", createCurrentBrandingRouter());
  }
  if (dependencies.launchpadDomainService) {
    const createCurrentDomainRouter = () =>
      createLaunchpadDomainRouter(dependencies.launchpadDomainService!);
    app.use("/v1/launchpads", createCurrentDomainRouter());
  }
  if (dependencies.launchpadDeveloperService) {
    const createCurrentDeveloperRouter = () =>
      createLaunchpadDeveloperRouter(dependencies.launchpadDeveloperService!);
    app.use("/v1/launchpads", createCurrentDeveloperRouter());
  }
  mountChainRouters("/v2/chains/:chainId/launchpads", ({ dependencies: chainDependencies }) => {
    if (!chainDependencies.launchpadCatalogService) return undefined;
    return createLaunchpadCatalogRouter(
      chainDependencies.launchpadCatalogService,
      chainDependencies.launchpadReadService,
      chainDependencies.launchpadBrandingService,
    );
  });
  mountChainRouters("/v2/chains/:chainId/launchpads", ({ dependencies: chainDependencies }) =>
    chainDependencies.launchpadBrandingService
      ? createLaunchpadBrandingRouter(chainDependencies.launchpadBrandingService)
      : undefined,
  );
  mountChainRouters("/v2/chains/:chainId/launchpads", ({ dependencies: chainDependencies }) =>
    chainDependencies.launchpadDomainService
      ? createLaunchpadDomainRouter(chainDependencies.launchpadDomainService)
      : undefined,
  );
  mountChainRouters("/v2/chains/:chainId/launchpads", ({ dependencies: chainDependencies }) =>
    chainDependencies.launchpadDeveloperService
      ? createLaunchpadDeveloperRouter(chainDependencies.launchpadDeveloperService)
      : undefined,
  );

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
