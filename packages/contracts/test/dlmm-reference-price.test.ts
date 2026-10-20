import assert from "node:assert/strict";
import test from "node:test";
import { observeDlmmReference } from "../scripts/dlmm-reference-price.ts";

async function withPrices(
  input: {
    ageSeconds?: number;
    coinbaseEth?: string;
    usdgUsd?: string;
    invalidPair?: boolean;
  },
  check: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const source = String(url);
    if (source.includes("coingecko"))
      return Response.json({
        ethereum: {
          usd: 2400,
          last_updated_at:
            Math.floor(Date.now() / 1000) - (input.ageSeconds ?? 0),
        },
        "global-dollar": {
          usd: input.usdgUsd ?? "1",
          last_updated_at: Math.floor(Date.now() / 1000),
        },
      });
    const usdg = source.includes("USDG-USD");
    return Response.json({
      data: {
        amount: usdg ? (input.usdgUsd ?? "1") : (input.coinbaseEth ?? "2401"),
        base: input.invalidPair ? "BTC" : usdg ? "USDG" : "ETH",
        currency: "USD",
      },
    });
  };
  try {
    await check();
  } finally {
    globalThis.fetch = original;
  }
}

test("DLMM reference derives ETH/USDG from both assets and independent providers", async () => {
  await withPrices({ usdgUsd: "1.01" }, async () => {
    const result = await observeDlmmReference();
    assert.equal(result.sources.length, 2);
    assert.ok(Number(result.wethPriceUsdg) < 2400);
    assert.ok(result.divergenceBps <= 100);
  });
});

test("DLMM reference rejects stale upstream observations", async () => {
  await withPrices({ ageSeconds: 901 }, async () => {
    await assert.rejects(observeDlmmReference(), /Stale/u);
  });
});

test("DLMM reference rejects a one-percent provider divergence", async () => {
  await withPrices({ coinbaseEth: "2600" }, async () => {
    await assert.rejects(observeDlmmReference(), /diverge/u);
  });
});

test("DLMM reference rejects USDG outside the reviewed peg range", async () => {
  await withPrices({ usdgUsd: "0.95" }, async () => {
    await assert.rejects(observeDlmmReference(), /peg range/u);
  });
});

test("DLMM reference rejects a provider returning another pair", async () => {
  await withPrices({ invalidPair: true }, async () => {
    await assert.rejects(observeDlmmReference(), /pair mismatch/u);
  });
});
