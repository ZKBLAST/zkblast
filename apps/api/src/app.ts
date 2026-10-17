import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { createAuthRouter } from "./auth-router.js";
import type { AuthService } from "./auth-service.js";
import { createIdentityRouter } from "./identity-router.js";
import type { IdentityService } from "./identity-service.js";

export type ApiPublicConfig = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
  webOrigin: string;
}>;

const publicConfigResponseSchema = z.object({
  environment: z.enum(["testnet", "mainnet"]),
  chainId: z.number().int().positive(),
  chainName: z.string().min(1),
  explorerUrl: z.string().url(),
});

export function createApp(
  config: ApiPublicConfig,
  dependencies: Readonly<{
    authService?: AuthService;
    identityService?: IdentityService;
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

  app.get("/v1/config", (_request, response) => {
    const body = publicConfigResponseSchema.parse({
      environment: config.environment,
      chainId: config.chainId,
      chainName: config.chainName,
      explorerUrl: config.explorerUrl,
    });
    response.json(body);
  });

  if (dependencies.authService) {
    app.use("/v1/auth", createAuthRouter(dependencies.authService));
  }
  if (dependencies.identityService) {
    app.use("/v1", createIdentityRouter(dependencies.identityService));
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
