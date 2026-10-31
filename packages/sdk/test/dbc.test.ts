import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { Address, Hex } from "viem";

import {
  assertDbcPreflight,
  DbcClient,
  explorerAddressUrl,
  explorerTransactionUrl,
  linearCurveQuote,
  resolveDbcAddresses,
  SdkError,
} from "../src/index.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}` as Hex;
const manifestPath = fileURLToPath(
  new URL("../../../deployments/testnet/manifest.json", import.meta.url),
);
const vectorPath = fileURLToPath(
  new URL("../../contracts/test-vectors/dbc/linear-v1.json", import.meta.url),
);

test("resolves DBC only from the selected network manifest", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const dbc = {
    abiVersion: 1,
    deploymentBlock: 123,
    configRegistry: address("101"),
    launchFactory: address("102"),
    curveQuoter: address("103"),
    launchpadRouter: address("104"),
    graduationManager: address("105"),
    dammGraduationAdapter: address("106"),
    lpAllocationEscrow: address("107"),
  } as const;
  const resolved = resolveDbcAddresses(
    { ...manifest, dbc },
    { environment: "testnet", chainId: 46_630 },
  );
  assert.equal(resolved.launchFactory, dbc.launchFactory);
  assert.throws(
    () => resolveDbcAddresses(manifest, { environment: "testnet", chainId: 46_630 }),
    (error: unknown) => error instanceof SdkError && error.code === "DBC_NOT_DEPLOYED",
  );
  assert.throws(() =>
    resolveDbcAddresses({ ...manifest, dbc }, { environment: "mainnet", chainId: 4663 }),
  );
});

test("builds typed launch, swap, graduation, fee and LP calls", () => {
  const client = new DbcClient({
    abiVersion: 1,
    configRegistry: address("1"),
    launchFactory: address("2"),
    curveQuoter: address("3"),
    launchpadRouter: address("4"),
    graduationManager: address("5"),
    dammGraduationAdapter: address("6"),
    lpAllocationEscrow: address("7"),
  });
  const pool = address("8");
  const user = address("9");
  const deadline = 2_000_000_000n;
  assert.equal(client.template(1n).functionName, "templateSummary");
  assert.equal(client.launch(hash("1")).functionName, "launches");
  assert.equal(client.quoteBuy(pool, 100n).functionName, "quoteBuyExactInput");
  assert.equal(client.quoteSell(pool, 10n).functionName, "quoteSellExactInput");
  assert.equal(client.createLaunch({ templateId: 1n, salt: hash("2"), name: "Launch", symbol: "LCH", metadataUri: "ipfs://launch", creatorTokenRecipient: user }).functionName, "createLaunch");
  assert.equal(client.buyExactInput({ pool, grossQuoteInRaw: 100n, minimumBaseOutRaw: 90n, maximumPriceX18: 2n, recipient: user, deadline }).functionName, "buyExactInput");
  assert.equal(client.sellExactInput({ pool, baseInRaw: 10n, minimumQuoteOutRaw: 9n, minimumPriceX18: 1n, recipient: user, deadline }).functionName, "sellExactInput");
  assert.equal(client.graduate(pool, deadline).functionName, "graduate");
  assert.equal(client.claimFees(pool, 2).functionName, "claimFees");
  assert.equal(client.claimLp(hash("3"), true, deadline).functionName, "claim");
});

test("preflight rejects chain, expiry, lifecycle, funds, allowance, slippage and stale quotes", () => {
  const valid = {
    expectedChainId: 4663,
    actualChainId: 4663,
    nowSeconds: 100,
    deadline: 200n,
    lifecycle: 1,
    allowedLifecycles: [1],
    requiredBalance: 100n,
    balance: 100n,
    requiredAllowance: 100n,
    allowance: 100n,
    quoteObservedAtSeconds: 95,
    maximumQuoteAgeSeconds: 10,
    quotedAmountOut: 1_000n,
    minimumAmountOut: 990n,
    maximumSlippageBps: 100,
  } as const;
  assert.doesNotThrow(() => assertDbcPreflight(valid));
  const cases = [
    [{ ...valid, actualChainId: 1 }, "INVALID_CHAIN"],
    [{ ...valid, deadline: 99n }, "INVALID_DEADLINE"],
    [{ ...valid, lifecycle: 2 }, "INVALID_LIFECYCLE"],
    [{ ...valid, balance: 99n }, "INSUFFICIENT_BALANCE"],
    [{ ...valid, allowance: 99n }, "INSUFFICIENT_ALLOWANCE"],
    [{ ...valid, minimumAmountOut: 989n }, "INVALID_SLIPPAGE"],
    [{ ...valid, quoteObservedAtSeconds: 80 }, "STALE_QUOTE"],
  ] as const;
  for (const [input, code] of cases) {
    assert.throws(
      () => assertDbcPreflight(input),
      (error: unknown) => error instanceof SdkError && error.code === code,
    );
  }
});

test("SDK math consumes the canonical contract vectors", async () => {
  const fixture = JSON.parse(await readFile(vectorPath, "utf8")) as {
    curve: { initialPriceX18: string; slopeX18: string; saleCapacityX18: string };
    vectors: { soldX18: string; baseAmountX18: string; quoteUpX18: string; quoteDownX18: string }[];
  };
  const curve = {
    initialPriceX18: BigInt(fixture.curve.initialPriceX18),
    slopeX18: BigInt(fixture.curve.slopeX18),
    saleCapacityX18: BigInt(fixture.curve.saleCapacityX18),
  };
  for (const vector of fixture.vectors) {
    assert.equal(linearCurveQuote(curve, BigInt(vector.soldX18), BigInt(vector.baseAmountX18), true), BigInt(vector.quoteUpX18));
    assert.equal(linearCurveQuote(curve, BigInt(vector.soldX18), BigInt(vector.baseAmountX18), false), BigInt(vector.quoteDownX18));
  }
});

test("explorer helpers never hardcode a network", () => {
  assert.equal(explorerTransactionUrl("https://explorer.example/", hash("a")), `https://explorer.example/tx/${hash("a")}`);
  assert.equal(explorerAddressUrl("https://explorer.example/", address("b")), `https://explorer.example/address/${address("b")}`);
});
