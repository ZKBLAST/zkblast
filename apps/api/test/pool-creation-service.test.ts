import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress, type Address, type PublicClient } from "viem";
import {
  PoolCreationService,
  poolCreationSchema,
} from "../src/pool-creation-service.js";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const input = {
  tokenA: address(2),
  tokenB: address(1),
  wallet: address(3),
  model: "damm",
  feePips: 3000,
  binStepBps: 0,
};
function fixture(
  authorized: boolean,
  existing: Address = zeroAddress,
  permissionless?: boolean,
) {
  let simulations = 0;
  const service = new PoolCreationService(
    {
      readContract: async (request: { functionName: string }) => {
        switch (request.functionName) {
          case "permissionlessCreation":
            if (permissionless === undefined) throw new Error("LEGACY_FACTORY");
            return permissionless;
          case "symbol":
            return "TOKEN";
          case "decimals":
            return 18;
          case "hasRole":
            return authorized;
          case "poolById":
            return existing;
          default:
            throw new Error("UNEXPECTED_READ");
        }
      },
      simulateContract: async () => {
        simulations++;
        return {} as never;
      },
    } as unknown as Pick<PublicClient, "readContract" | "simulateContract">,
    address(4),
    address(5),
    4663,
  );
  return { service, simulations: () => simulations };
}

test("authorized DAMM creation sorts tokens and simulates without broadcasting", async () => {
  const fixtureData = fixture(true);
  const result = await fixtureData.service.prepare(input);
  assert.equal(result.token0.address, address(1));
  assert.equal(result.simulationPassed, true);
  assert.equal(fixtureData.simulations(), 1);
  assert.equal(result.chainId, 4663);
  assert.equal(result.transaction.value, "0x0");
});

test("permissionless Factory accepts non-admin wallets for DAMM and DLMM", async () => {
  for (const model of ["damm", "dlmm"] as const) {
    const setup = fixture(false, zeroAddress, true);
    const result = await setup.service.prepare({
      ...input,
      model,
      binStepBps: model === "dlmm" ? 10 : 0,
      ...(model === "dlmm" ? { initialPrice: "1" } : {}),
    });
    assert.equal(result.authorized, true);
    assert.equal(result.creationAccess, "permissionless");
    assert.equal(result.simulationPassed, true);
    assert.equal(setup.simulations(), 1);
  }
});

test("explicit restricted capability and duplicate public pools remain blocked", async () => {
  const restricted = await fixture(false, zeroAddress, false).service.prepare(
    input,
  );
  assert.equal(restricted.authorized, false);
  assert.equal(restricted.creationAccess, "governance");
  const duplicate = fixture(false, address(6), true);
  assert.equal(
    (await duplicate.service.prepare(input)).simulationPassed,
    false,
  );
  assert.equal(duplicate.simulations(), 0);
});

test("unauthorized or duplicate pools cannot receive a passed simulation", async () => {
  for (const setup of [fixture(false), fixture(true, address(6))]) {
    const result = await setup.service.prepare(input);
    assert.equal(result.simulationPassed, false);
    assert.equal(setup.simulations(), 0);
  }
});

test("DLMM initial price is canonicalized and invalid configurations rejected", async () => {
  const result = await fixture(true).service.prepare({
    ...input,
    model: "dlmm",
    binStepBps: 10,
    initialPrice: "2",
  });
  assert.ok(result.initialBin !== null && result.initialBin < 0);
  assert.ok(
    Number(result.representedPrice) > 0.49 &&
      Number(result.representedPrice) < 0.51,
  );
  assert.equal(
    poolCreationSchema.safeParse({ ...input, tokenB: input.tokenA }).success,
    false,
  );
  assert.equal(
    poolCreationSchema.safeParse({ ...input, model: "dlmm" }).success,
    false,
  );
  assert.equal(
    poolCreationSchema.safeParse({ ...input, binStepBps: 10 }).success,
    false,
  );
});
