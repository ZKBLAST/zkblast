import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet");
assert(process.env.RPC_URL);
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
assert.equal(manifest.chainId, 4663);
assert(manifest.launchpad && manifest.dbc && manifest.shielded);
const configManager = getAddress(manifest.launchpad.configManager);
const dbcRegistry = getAddress(manifest.dbc.configRegistry);
const usdg = getAddress(manifest.shielded.assets.find((asset: any) => asset.symbol === "USDG").address);
const safe = getAddress(manifest.governanceAddress);
const deployer = getAddress(manifest.deployerAddress);
const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [configAbi, dbcAbi] = await Promise.all([artifact("LaunchpadConfigManager"), artifact("LaunchConfigRegistry")]);
const safeAbi = parseAbi(["function nonce() view returns(uint256)"]);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), 4663);
const [block, safeNonce, deployerNonce, presetCount, templateCount, template, quoteAllowed, dammSupported] = await Promise.all([
  client.getBlock(),
  client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.readContract({ address: configManager, abi: configAbi, functionName: "presetCount" }),
  client.readContract({ address: dbcRegistry, abi: dbcAbi, functionName: "templateCount" }),
  client.readContract({ address: dbcRegistry, abi: dbcAbi, functionName: "templateEconomics", args: [1n] }),
  client.readContract({ address: configManager, abi: configAbi, functionName: "quoteTokenAllowed", args: [usdg] }),
  client.readContract({ address: configManager, abi: configAbi, functionName: "destinationSupported", args: [1] }),
]);
assert.equal(presetCount, 0n, "Launchpad preset already exists");
assert(
  BigInt(String(templateCount)) >= 1n
    && getAddress(String((template as readonly unknown[])[0])) === usdg,
  "DBC template 1 is not the canonical USDG template",
);
assert(dammSupported, "DAMM destination is not enabled");
const familyId = keccak256(toHex("ZKBLAST_LAUNCHPAD_DAMM_USDG_V1"));
const preset = {
  familyId,
  dbcTemplateId: 1n,
  quoteToken: usdg,
  maximumTotalTradeFeeBps: 300,
  graduationDestination: 1,
  creatorAccess: 0,
  maximumLaunches: 1000,
} as const;
const actions = [
  ...(!quoteAllowed ? [{
    name: "allow-usdg-quote-token",
    target: configManager,
    data: encodeFunctionData({ abi: configAbi, functionName: "setQuoteToken", args: [usdg, true] }),
  }] : []),
  {
    name: "create-damm-usdg-preset-v1",
    target: configManager,
    data: encodeFunctionData({ abi: configAbi, functionName: "createPreset", args: [preset] }),
  },
].map((action, index) => ({
  ...action,
  safeNonce: (safeNonce + BigInt(index)).toString(),
  relayerNonce: deployerNonce + index,
  calldataHash: keccak256(action.data),
}));
const plan = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governanceSafe: safe,
  relayer: deployer,
  configManager,
  usdg,
  dbcTemplateId: "1",
  proposedPresetId: "1",
  preset: { ...preset, dbcTemplateId: preset.dbcTemplateId.toString() },
  actions,
  safety: {
    permissionlessLaunchpadCreation: true,
    tokenCreatorAccess: "owner-or-operator",
    dammOnly: true,
    dlmmEnabled: false,
    zkProofClaimsEnabled: false,
    assetMovement: false,
  },
  broadcastAllowed: false,
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(root, "deployments/mainnet/launchpad-preset-v1-plan.json");
await writeFile(output, serialized);
console.log(JSON.stringify({
  referenceBlock: plan.referenceBlock,
  safeNonce: safeNonce.toString(),
  relayerNonce: deployerNonce,
  actions: actions.length,
  proposedPresetId: plan.proposedPresetId,
  planSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
}));
