import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { LiquidityService } from "../src/liquidity-service.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const addresses = {
  poolRegistry: address("1"),
  poolFactory: address("2"),
  swapRouter: address("3"),
  positionManager: address("4"),
  poolQuoter: address("5"),
};
const pool = address("6");
const token0 = address("7");
const token1 = address("8");
const owner = address("9");

test("prepares two approvals and a DAMM position call only for matching pool tokens", async () => {
  const service = new LiquidityService(
    {
      readContract: async (request) =>
        request.functionName === "token0" ? token0 : token1,
    },
    addresses,
    46630,
    async () => true,
  );
  const result = await service.prepareCreate({
    model: "damm",
    pool,
    token0,
    token1,
    amount0: "100",
    amount1: "200",
    minimumShares: "1",
    deadline: "2000000000",
  });
  assert.equal(result.approvals.length, 2);
  assert.equal(result.approvals[0]?.to, token0);
  assert.equal(result.position.to, addresses.positionManager);
});

test("rejects a position mutation prepared by a non-owner", async () => {
  const service = new LiquidityService(
    { readContract: async () => [address("10"), pool, 0, 0, 100n] },
    addresses,
    46630,
    async () => true,
  );
  await assert.rejects(
    service.prepareDecrease({
      owner,
      positionId: "1",
      shares: "50",
      minimumAmount0: "0",
      minimumAmount1: "0",
      recipient: owner,
      deadline: "2000000000",
    }),
    /UNAUTHORIZED_POSITION/u,
  );
});

test("fee claims are withheld unless the wallet is the onchain recipient", async () => {
  const service = new LiquidityService(
    { readContract: async () => owner },
    addresses,
    46630,
    async () => true,
  );
  const denied = await service.prepareFeeClaim({
    model: "damm",
    pool,
    wallet: address("10"),
  });
  const allowed = await service.prepareFeeClaim({
    model: "damm",
    pool,
    wallet: owner,
  });
  assert.equal(denied.eligible, false);
  assert.equal(denied.claim, null);
  assert.equal(allowed.eligible, true);
  assert.equal(allowed.claim?.to, pool);
});

test("DAMM accounting reconciles reserves plus protocol fees with balances", async () => {
  const values: Record<string, unknown> = {
    token0,
    token1,
    reserve0: 95n,
    reserve1: 190n,
    totalShares: 50n,
    protocolFees0: 5n,
    protocolFees1: 10n,
    sharesOf: 25n,
  };
  const service = new LiquidityService(
    {
      readContract: async (request) =>
        request.functionName === "balanceOf"
          ? request.address === token0
            ? 100n
            : 200n
          : values[String(request.functionName)],
    },
    addresses,
    46630,
    async () => true,
  );
  const result = await service.accounting(pool, owner);
  assert.equal(result.reconciled, true);
  assert.equal(result.walletShares, "25");
});
