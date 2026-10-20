import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { positionManagerAbi } from "@zkblast/abi";
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

test("DLMM creation defaults to the live negative active bin rather than parity", async () => {
  const service = new LiquidityService(
    {
      readContract: async (request) => {
        if (request.functionName === "token0") return token0;
        if (request.functionName === "token1") return token1;
        if (request.functionName === "activeBin") return -7951;
        throw new Error("UNEXPECTED_READ");
      },
    },
    addresses,
    46630,
    async () => true,
  );
  const prepared = await service.prepareCreate({
    model: "dlmm",
    pool,
    token0,
    token1,
    amount0: "100",
    amount1: "200",
    minimumShares: "1",
    deadline: "2000000000",
  });
  const call = decodeFunctionData({
    abi: positionManagerAbi,
    data: prepared.position.data as Hex,
  });
  assert.equal(call.functionName, "createDlmmPosition");
  assert.equal(call.args?.[1], -7951);
});

test("DLMM creation rejects a bin outside the contract price bounds", async () => {
  const service = new LiquidityService(
    {
      readContract: async (request) =>
        request.functionName === "token0" ? token0 : token1,
    },
    addresses,
    46630,
    async () => true,
  );
  await assert.rejects(
    service.prepareCreate({
      model: "dlmm",
      pool,
      token0,
      token1,
      amount0: "100",
      amount1: "200",
      minimumShares: "1",
      deadline: "2000000000",
      binId: -10001,
    }),
    /INVALID_BIN/u,
  );
});

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

test("applies a one-percent withdrawal bound from live pool accounting", async () => {
  const values: Record<string, unknown> = {
    positions: [owner, pool, 0, 0, 100n],
    reserve0: 1_000n,
    reserve1: 2_000n,
    totalShares: 100n,
  };
  const service = new LiquidityService(
    {
      readContract: async (request) => values[String(request.functionName)],
    },
    addresses,
    46630,
    async () => true,
  );
  const result = await service.prepareDecrease({
    owner,
    positionId: "1",
    shares: "50",
    minimumAmount0: "0",
    minimumAmount1: "0",
    recipient: owner,
    deadline: "2000000000",
  });
  assert.equal(result.minimumAmount0, "495");
  assert.equal(result.minimumAmount1, "990");
});

test("lists only live positions owned by the requested wallet", async () => {
  const other = address("10");
  const service = new LiquidityService(
    {
      readContract: async (request) => {
        if (request.functionName === "nextPositionId") return 3n;
        if (request.functionName === "positions")
          return (request.args as readonly unknown[] | undefined)?.[0] === 1n
            ? [owner, pool, 0, 0, 50n]
            : [other, pool, 0, 0, 25n];
        if (request.functionName === "token0") return token0;
        if (request.functionName === "token1") return token1;
        if (
          request.functionName === "symbol" ||
          request.functionName === "decimals"
        )
          assert.doesNotThrow(() =>
            encodeFunctionData({
              abi: request.abi as Abi,
              functionName: String(request.functionName),
            }),
          );
        if (request.functionName === "symbol")
          return request.address === token0 ? "AMD" : "USDG";
        if (request.functionName === "decimals")
          return request.address === token0 ? 18 : 6;
        throw new Error("UNEXPECTED_READ");
      },
    },
    addresses,
    46630,
    async () => true,
  );
  const result = await service.positionsForOwner(owner);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.onchainPositionId, "1");
  assert.equal(result[0]?.token0Symbol, "AMD");
  assert.equal(result[0]?.token1Symbol, "USDG");
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
