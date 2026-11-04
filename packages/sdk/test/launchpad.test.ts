import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData } from "viem";

import { LaunchpadClient, type LaunchpadAddresses } from "../src/launchpad.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const addresses: LaunchpadAddresses = {
  abiVersion: 1,
  registry: address("1"),
  configManager: address("2"),
  factory: address("3"),
  lens: address("4"),
  feeController: address("5"),
  revenueSplitter: address("6"),
  feeCollector: address("7"),
  tokenFactory: address("8"),
};

test("prepares a versioned launchpad token call and fee collection", () => {
  const client = new LaunchpadClient(addresses);
  const launchpadCall = client.createLaunchpad({
    owner: address("9"),
    treasury: address("a"),
    metadataHash: `0x${"b".repeat(64)}`,
    slugCommitment: `0x${"c".repeat(64)}`,
    configPresetId: 2n,
  });
  assert.equal(launchpadCall.address, addresses.factory);
  assert.equal(launchpadCall.functionName, "createLaunchpad");
  assert.equal(launchpadCall.args[4], 2n);
  const policyCall = client.setFeePolicy({
    launchpadId: 4n,
    totalTradeFeeBps: 30,
    protocolShareBps: 2_000,
    operatorShareBps: 3_000,
    creatorShareBps: 5_000,
    referralShareBps: 0,
    operatorRecipient: address("a"),
  });
  assert.equal(policyCall.address, addresses.feeController);
  assert.equal(policyCall.functionName, "setLaunchpadFeePolicy");
  assert.throws(
    () =>
      client.setFeePolicy({
        launchpadId: 4n,
        totalTradeFeeBps: 30,
        protocolShareBps: 2_000,
        operatorShareBps: 3_000,
        creatorShareBps: 4_999,
        referralShareBps: 0,
        operatorRecipient: address("a"),
      }),
    /10,000/u,
  );
  const call = client.createToken({
    launchpadId: 4n,
    templateId: 2n,
    salt: `0x${"a".repeat(64)}`,
    name: "Example Token",
    symbol: "EXAMPLE",
    metadataUri: "ipfs://example",
    creatorTokenRecipient: address("9"),
    referralRecipient: address("0"),
  });
  assert.equal(call.address, addresses.tokenFactory);
  assert.equal(call.functionName, "createLaunch");
  assert.equal((call.args[0] as { launchpadId: bigint }).launchpadId, 4n);
  assert.equal(client.binding(`0x${"b".repeat(64)}`).functionName, "binding");
  assert.equal(
    String(client.collectTradeFees(address("c")).args[0]).toLowerCase(),
    address("c"),
  );
});

test("prepares a protected token call through the canonical launchpad factory", () => {
  const call = new LaunchpadClient(addresses).createProtectedToken({
    launchpadId: 4n,
    templateId: 2n,
    policyId: 1n,
    salt: `0x${"d".repeat(64)}`,
    deadline: 1_900_000_000n,
    name: "Protected Token",
    symbol: "PRT",
    metadataUri: "ipfs://protected",
    creator: address("9"),
    creatorTokenRecipient: address("9"),
    referralRecipient: address("0"),
  });
  assert.equal(call.address, addresses.tokenFactory);
  assert.equal(call.functionName, "createProtectedLaunch");
  assert.equal(call.args[0], 4n);
  assert.match(String(call.args[1]), /^0x[\da-f]+$/iu);
  assert.equal(call.args[2], address("0"));
  assert.match(
    encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    }),
    /^0x[\da-f]+$/iu,
  );
});
