import assert from "node:assert/strict";
import test from "node:test";
import { parseEther, type Address, type PublicClient } from "viem";
import {
  quoteFactoryUpgradeFees,
  summarizeUpgradeFees,
} from "../scripts/factory-upgrade-fees.js";

const deployer = "0x0000000000000000000000000000000000000001" as Address;
const governor = "0x0000000000000000000000000000000000000002" as Address;
const stages = [
  {
    stage: "deploy-factory-implementation",
    gasUsed: "90",
    estimateGas: "100",
    fundingAccount: deployer,
  },
  {
    stage: "schedule-upgrade",
    gasUsed: "40",
    estimateGas: "50",
    fundingAccount: governor,
  },
];

test("fee quote uses gas estimates, rounds the buffer up, and separates funding wallets", () => {
  const result = summarizeUpgradeFees(stages, 10n);
  assert.equal(result.estimatedGas, "150");
  assert.equal(result.suggestedGasLimit, "188");
  assert.equal(result.suggestedGasPriceCapWei, "20");
  assert.equal(parseEther(result.estimatedFeeETH), 1500n);
  assert.equal(parseEther(result.suggestedFeeCeilingETH), 3760n);
  assert.equal(result.funding.length, 2);
});

test("live creation estimate replaces only deployment gas, leaving future-state stages explicit", async () => {
  let calls = 0;
  const live = {
    estimateGas: async () => {
      calls++;
      return 120n;
    },
    getGasPrice: async () => 10n,
  } as unknown as PublicClient;
  const result = await quoteFactoryUpgradeFees(live, stages, {
    factory: "0x1234",
  });
  assert.equal(calls, 1);
  assert.equal(result.estimatedGas, "170");
  assert.equal(result.stages[0]?.estimationSource, "live-rpc-creation");
  assert.equal(result.stages[1]?.estimationSource, "local-fork-future-state");
  assert.equal(stages[0]?.estimateGas, "100");
});
