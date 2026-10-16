import express from "express";
import helmet from "helmet";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  return app;
}
