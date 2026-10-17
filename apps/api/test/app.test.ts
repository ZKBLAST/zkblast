import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp({
  environment: "testnet",
  chainId: 46_630,
  chainName: "Test Chain",
  explorerUrl: "https://explorer.example",
  webOrigin: "http://127.0.0.1:3000",
});

test("public config excludes internal connection details", async () => {
  const response = await request(app)
    .get("/v1/config")
    .set("origin", "http://127.0.0.1:3000");

  assert.equal(response.status, 200);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://127.0.0.1:3000",
  );
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.deepEqual(response.body, {
    environment: "testnet",
    chainId: 46_630,
    chainName: "Test Chain",
    explorerUrl: "https://explorer.example",
  });
});

test("unknown route returns a sanitized error", async () => {
  const response = await request(app).get("/does-not-exist");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: { code: "NOT_FOUND" } });
});
