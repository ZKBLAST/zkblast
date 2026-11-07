import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  padHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
  chainId: number;
  governanceAddress: Address;
  launchpad: { configManager: Address };
  dbc: { configRegistry: Address };
};
assert.equal(manifest.chainId, 99_801);
const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [configAbi, dbcAbi] = await Promise.all([
  artifact("LaunchpadConfigManager"),
  artifact("LaunchConfigRegistry"),
]);
const client = createPublicClient({
  transport: http(process.env.ELYSIUM_PRIVATE_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz", {
    timeout: 20_000,
    retryCount: 2,
  }),
});
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function paced<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const result = await operation();
      await pause(350);
      return result;
    } catch (error) {
      lastError = error;
      await pause(1_000 * (attempt + 1));
    }
  }
  throw lastError;
}
assert.equal(await client.getChainId(), 99_801);
const governance = getAddress(manifest.governanceAddress);
const configManager = getAddress(manifest.launchpad.configManager);
const configRegistry = getAddress(manifest.dbc.configRegistry);
const template = await client.readContract({
  address: configRegistry,
  abi: dbcAbi,
  functionName: "templateEconomics",
  args: [1n],
}) as readonly unknown[];
const quoteToken = getAddress(String(template[0]));
const configAdminRole = await client.readContract({
  address: configManager,
  abi: configAbi,
  functionName: "CONFIG_ADMIN_ROLE",
}) as Hex;
const block = await paced(() => client.getBlock());
const presetCount = await paced(() => client.readContract({ address: configManager, abi: configAbi, functionName: "presetCount" }));
const quoteAllowed = await paced(() => client.readContract({ address: configManager, abi: configAbi, functionName: "quoteTokenAllowed", args: [quoteToken] }));
const dammSupported = await paced(() => client.readContract({ address: configManager, abi: configAbi, functionName: "destinationSupported", args: [1] }));
const hasRole = await paced(() => client.readContract({ address: configManager, abi: configAbi, functionName: "hasRole", args: [configAdminRole, governance] }));
const nonce = await paced(() => client.getTransactionCount({ address: governance, blockTag: "pending" }));
const balance = await paced(() => client.getBalance({ address: governance }));
const gasPrice = await paced(() => client.getGasPrice());
const quoteCode = await paced(() => client.getCode({ address: quoteToken }));
assert.equal(presetCount, 0n, "ELYSIUM_PRESET_ALREADY_EXISTS");
assert.equal(quoteAllowed, false, "ELYSIUM_QUOTE_ALREADY_ALLOWED");
assert.equal(dammSupported, true, "ELYSIUM_PENDING_DESTINATION_UNAVAILABLE");
assert.equal(hasRole, true, "ELYSIUM_CONFIG_ROLE_MISSING");
assert(quoteCode && quoteCode !== "0x", "ELYSIUM_QUOTE_TOKEN_CODE_MISSING");

const preset = {
  familyId: keccak256(toHex("ZKBLAST_ELYSIUM_WHYPE_PENDING_GRADUATION_V1")),
  dbcTemplateId: 1n,
  quoteToken,
  maximumTotalTradeFeeBps: 300,
  graduationDestination: 1,
  creatorAccess: 0,
  maximumLaunches: 1000,
} as const;
const actions = [
  {
    name: "allow-whype-quote-token",
    data: encodeFunctionData({ abi: configAbi, functionName: "setQuoteToken", args: [quoteToken, true] }),
  },
  {
    name: "create-whype-pending-graduation-preset-v1",
    data: encodeFunctionData({ abi: configAbi, functionName: "createPreset", args: [preset] }),
  },
].map((action, index) => ({
  ...action,
  target: configManager,
  nonce: nonce + index,
  calldataHash: keccak256(action.data),
}));
const quoteAllowedSlot = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }],
  [quoteToken, 5n],
));
const gasEstimates = [
  await paced(() => client.estimateGas({ account: governance, to: configManager, data: actions[0]!.data })),
  await paced(() => client.estimateGas({
    account: governance,
    to: configManager,
    data: actions[1]!.data,
    stateOverride: [{
      address: configManager,
      stateDiff: [{ slot: quoteAllowedSlot, value: padHex("0x01", { size: 32 }) }],
    }],
  })),
];
const guardedGas = gasEstimates.map((gas) => (gas * 150n) / 100n);
const maximumFeeWei = guardedGas.reduce((total, gas) => total + gas * gasPrice, 0n);
assert(balance > maximumFeeWei, "ELYSIUM_PRESET_GAS_BALANCE_INSUFFICIENT");
const plan = {
  schemaVersion: 1,
  chainId: 99_801,
  environment: "testnet",
  generatedAt: new Date().toISOString(),
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governance,
  configManager,
  configRegistry,
  quoteToken,
  proposedPresetId: "1",
  preset: { ...preset, dbcTemplateId: preset.dbcTemplateId.toString() },
  startingNonce: nonce,
  nextNonce: nonce + actions.length,
  actions: actions.map((action, index) => ({
    ...action,
    gasEstimate: gasEstimates[index]!.toString(),
    guardedGas: guardedGas[index]!.toString(),
  })),
  gasPriceWei: gasPrice.toString(),
  maximumFeeWei: maximumFeeWei.toString(),
  maximumFeeHype: formatEther(maximumFeeWei),
  balanceHype: formatEther(balance),
  safety: {
    assetMovement: false,
    graduationExecutionEnabled: false,
    graduationBehavior: "pending_until_reviewed_adapter",
    broadcastAllowed: false,
    explicitApprovalRequired: true,
  },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(directory, "launchpad-preset-v1-plan.json");
await writeFile(output, serialized, { mode: 0o644 });
console.log(JSON.stringify({
  chainId: plan.chainId,
  referenceBlock: plan.referenceBlock,
  governance,
  startingNonce: nonce,
  nextNonce: plan.nextNonce,
  quoteToken,
  actions: plan.actions.map(({ name, gasEstimate, guardedGas }) => ({ name, gasEstimate, guardedGas })),
  maximumFeeHype: plan.maximumFeeHype,
  balanceHype: plan.balanceHype,
  planSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
  output,
}, null, 2));
