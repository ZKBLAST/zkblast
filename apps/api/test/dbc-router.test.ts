import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import request from "supertest";
import type { Address } from "viem";
import { createDbcRouter } from "../src/dbc-router.js";
import { DbcService, type DbcReadStore } from "../src/dbc-service.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const store: DbcReadStore = {
  templates: async () => [{ templateId: "1" }],
  launches: async () => [{ launchId: `0x${"1".repeat(64)}` }],
  launch: async (id) => ({ launchId: id }),
  launchByPool: async () => ({ lifecycle: 1 }),
  trades: async () => [],
  candles: async () => [],
  graduation: async () => null,
  saveMetadata: async () => undefined,
  metadata: async () => null,
  protectionPolicies: async () => [{ chain_id:4663,policy_id:"1",policy_hash:`0x${"2".repeat(64)}` }],
  protectionPolicy: async () => ({
    chain_id:4663,policy_id:"1",policy_hash:`0x${"2".repeat(64)}`,version:1,
    protection_blocks:"10",max_buy_bps_per_transaction:100,max_buy_bps_per_address:500,
    initial_fee_bps:500,base_fee_bps:30,lp_lock_seconds:"86400",enabled:true,used:false,
  }),
  protectedLaunchSecurity: async (id) => ({ launch_id:id,policy_hash:`0x${"2".repeat(64)}` }),
  protectedLaunchIdentity: async (id) => ({ launch_id:id,token_template_version:1 }),
};
const service = new DbcService(
  store,
  {
    quote: async ({ amountRaw }) => ({ amountOutRaw: amountRaw * 2n }),
    templateEconomics: async () => [
      address("9"),
      1_000n,
      800n,
      500n,
      3_000,
      100,
      30,
      5_000,
      0,
      5_000,
      5_000,
      86_400,
    ],
    templateConfig: async () => ({
      curve: {
        segmentCount: 1,
        segments: [{ initialPriceX18: 1n, slopeX18: 2n, saleCapacityX18: 3n }],
      },
    }),
    tokenMetadata: async () => ({ symbol: "USDG", decimals: 6 }),
  },
  {
    abiVersion: 1,
    configRegistry: address("1"),
    launchFactory: address("2"),
    curveQuoter: address("3"),
    launchpadRouter: address("4"),
    graduationManager: address("5"),
    dammGraduationAdapter: address("6"),
    lpAllocationEscrow: address("7"),
  },
);
const app = express();
app.use(express.json());
app.use("/v1/dbc", createDbcRouter(service));

test("DBC API exposes bounded discovery, quote and deployment endpoints", async () => {
  assert.equal(
    (await request(app).get("/v1/dbc/templates?limit=10")).status,
    200,
  );
  assert.equal(
    (await request(app).get("/v1/dbc/launches?limit=101")).status,
    500,
  );
  const quote = await request(app)
    .post("/v1/dbc/quote")
    .send({ pool: address("8"), side: "buy", amountRaw: "5" });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.amountOutRaw, "10");
  const economics = await request(app).get("/v1/dbc/templates/1/economics");
  assert.equal(economics.status, 200);
  assert.equal(economics.body.tradeFeeBps, 30);
  const deployment = await request(app).get("/v1/dbc/deployment");
  assert.equal(deployment.status, 200);
  assert.equal(deployment.body.launchFactory, address("2"));
});

test("DBC candle API rejects unbounded ranges and invalid intervals", async () => {
  const id = `0x${"1".repeat(64)}`;
  const response = await request(app)
    .get(`/v1/dbc/launches/${id}/candles`)
    .query({ interval: "2m", from: "2026-01-01", to: "2026-03-01" });
  assert.equal(response.status, 500);
  assert.ok(response.error);
});

test("protected launch API returns exact policy identity and bounded preview", async () => {
  const catalog = await request(app).get("/v1/dbc/protection/policies?limit=10");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.items[0].chain_id, 4663);

  const preview = await request(app).post("/v1/dbc/protection/preview").send({
    policyId:"1",baseInventoryRaw:"1000000",currentBlock:"100",
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.protectionEndBlock, "110");
  assert.equal(preview.body.maximumPerTransactionRaw, "10000");
  assert.equal(preview.body.maximumPerAddressRaw, "50000");
  assert.equal(preview.body.enforcement, "onchain");

  const id = `0x${"1".repeat(64)}`;
  assert.equal((await request(app).get(`/v1/dbc/launches/${id}/security`)).status, 200);
  assert.equal((await request(app).get(`/v1/dbc/launches/${id}/identity`)).status, 200);
});
