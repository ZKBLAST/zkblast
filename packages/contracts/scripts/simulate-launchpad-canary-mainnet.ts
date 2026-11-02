import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  keccak256,
  stringToHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/launchpad-canary-v1-plan.json");
const planBytes = await readFile(planPath);
const plan = JSON.parse(planBytes.toString("utf8")) as any;
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.broadcastAllowed, false);
const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [factoryAbi, feeAbi, tokenFactoryAbi, registryAbi] = await Promise.all([
  artifact("LaunchpadFactory"), artifact("LaunchpadFeeController"), artifact("LaunchpadTokenFactory"), artifact("LaunchpadRegistry"),
]);
const transport = http(process.env.LOCAL_FORK_RPC_URL ?? "http://127.0.0.1:18549");
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.LOCAL_FORK_RPC_URL ?? "http://127.0.0.1:18549"] } },
});
const client = createPublicClient({ chain, transport });
assert.equal(await client.getChainId(), 4663);
const owner = getAddress(plan.owner) as Address;
await client.request({ method: "anvil_impersonateAccount", params: [owner] } as any);
await client.request({ method: "anvil_setBalance", params: [owner, "0x8ac7230489e80000"] } as any);
const wallet = createWalletClient({ account: owner, chain, transport });
const receipts: Array<{ name: string; hash: Hex; gasUsed: string }> = [];
const record = async (name: string, hash: Hex) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `${name} reverted`);
  receipts.push({ name, hash, gasUsed: receipt.gasUsed.toString() });
  return receipt;
};
const createRequest = await client.simulateContract({
  account: owner,
  address: getAddress(plan.addresses.factory),
  abi: factoryAbi,
  functionName: "createLaunchpad",
  args: [owner, owner, plan.metadataHash, plan.slugCommitment, 1n],
});
await record("create-launchpad", await wallet.writeContract(createRequest.request));
const launchpadId = await client.readContract({
  address: getAddress(plan.addresses.registry), abi: registryAbi, functionName: "launchpadCount",
});
assert.equal(launchpadId, BigInt(plan.predictedLaunchpadId));
const feeRequest = await client.simulateContract({
  account: owner,
  address: getAddress(plan.addresses.feeController),
  abi: feeAbi,
  functionName: "setLaunchpadFeePolicy",
  args: [launchpadId, 30, {
    protocolShareBps: 2_000,
    operatorShareBps: 3_000,
    creatorShareBps: 5_000,
    referralShareBps: 0,
  }, owner],
});
await record("configure-fee-policy", await wallet.writeContract(feeRequest.request));
const tokenRequest = {
  launchpadId,
  dbc: {
    templateId: 1n,
    salt: keccak256(stringToHex("ZKBLAST_MAINNET_CANARY_TOKEN_V1")),
    name: "ZKBLAST Launchpad Canary",
    symbol: "ZLPC",
    metadataURI: "zkblast://mainnet-canary-v1",
    creatorTokenRecipient: owner,
  },
  referralRecipient: zeroAddress,
} as const;
const tokenSimulation = await client.simulateContract({
  account: owner,
  address: getAddress(plan.addresses.tokenFactory),
  abi: tokenFactoryAbi,
  functionName: "createLaunch",
  args: [tokenRequest],
});
await record("create-bound-token", await wallet.writeContract(tokenSimulation.request));
const [launchId, token, pool, feeSnapshotId] = tokenSimulation.result as readonly [Hex, Address, Address, Hex];
const binding = await client.readContract({
  address: getAddress(plan.addresses.tokenFactory), abi: tokenFactoryAbi, functionName: "binding", args: [launchId],
}) as any;
assert.equal(binding.launchpadId, launchpadId);
assert.equal(getAddress(binding.token), getAddress(token));
assert.equal(getAddress(binding.virtualPool), getAddress(pool));
assert.equal(binding.feeSnapshotId, feeSnapshotId);
const gasUsed = receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n);
const bufferedGas = gasUsed * 150n / 100n;
const gasPrice = BigInt(plan.liveEstimate.gasPriceWei);
const output = {
  schemaVersion: 1,
  environment: "mainnet-fork",
  chainId: 4663,
  planSha256: createHash("sha256").update(planBytes).digest("hex"),
  launchpadId: launchpadId.toString(),
  launchId,
  token,
  pool,
  feeSnapshotId,
  receipts,
  gasUsed: gasUsed.toString(),
  bufferedGas: bufferedGas.toString(),
  sampledGasPriceWei: gasPrice.toString(),
  bufferedFeeWei: (bufferedGas * gasPrice).toString(),
  bufferedFeeEth: formatEther(bufferedGas * gasPrice),
  verified: true,
  broadcastAllowed: false,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
const outputPath = path.join(root, "deployments/mainnet/launchpad-canary-v1-simulation.json");
await writeFile(outputPath, serialized);
console.log(JSON.stringify({ ...output, outputPath }));
