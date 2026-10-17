import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { SwapService } from "../src/swap-service.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const addresses = {
  poolRegistry: address("1"),
  poolFactory: address("2"),
  swapRouter: address("3"),
  positionManager: address("4"),
  poolQuoter: address("5"),
};

test("server quote prepares approval and slippage-protected swap calldata", async () => {
  const service = new SwapService(
    { readContract: async () => [1_000n, 3n] },
    addresses,
    46630,
    async () => true,
  );
  const result = await service.quote({
    model: "damm",
    pool: address("6"),
    tokenIn: address("7"),
    amountIn: "500",
    slippageBps: 100,
    recipient: address("8"),
    deadline: "2000000000",
  });
  assert.equal(result.chainId, 46630);
  assert.equal(result.minimumAmountOut, "990");
  assert.equal(result.approval.to, address("7"));
  assert.equal(result.swap.to, addresses.swapRouter);
  assert.match(result.swap.data, /^0x[0-9a-f]+$/u);
});

test("unregistered pool cannot obtain executable calldata", async () => {
  const service = new SwapService(
    { readContract: async () => [1_000n, 3n] },
    addresses,
    46630,
    async () => false,
  );
  await assert.rejects(
    service.quote({
      model: "damm",
      pool: address("6"),
      tokenIn: address("7"),
      amountIn: "500",
      slippageBps: 100,
      recipient: address("8"),
      deadline: "2000000000",
    }),
    /UNREGISTERED_POOL/u,
  );
});
