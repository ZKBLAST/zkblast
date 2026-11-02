import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet");
assert(process.env.RPC_URL);
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
assert.equal(manifest.chainId, 4663);
assert(manifest.launchpad && manifest.dbc && manifest.shielded);
const owner = getAddress(manifest.deployerAddress);
const launchpad = Object.fromEntries(
  ["registry", "configManager", "factory", "feeController", "revenueSplitter", "feeCollector", "tokenFactory", "lens"]
    .map((key) => [key, getAddress(manifest.launchpad[key])]),
) as Record<string, Address>;
const dbcRegistry = getAddress(manifest.dbc.configRegistry);
const router = getAddress(manifest.dbc.launchpadRouter);
const usdg = getAddress(manifest.shielded.assets.find((asset: any) => asset.symbol === "USDG").address);
const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [registryAbi, configAbi, factoryAbi, feeAbi, tokenFactoryAbi, dbcAbi] = await Promise.all([
  artifact("LaunchpadRegistry"), artifact("LaunchpadConfigManager"), artifact("LaunchpadFactory"),
  artifact("LaunchpadFeeController"), artifact("LaunchpadTokenFactory"), artifact("LaunchConfigRegistry"),
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
]);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 30_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), 4663);

const branding = {
  schemaVersion: 1,
  slug: "zkblast-mainnet-canary",
  name: "ZKBLAST Mainnet Canary",
  description: "Minimum-value mainnet acceptance launchpad for ZKBLAST.",
  primaryColor: "#c7f456",
  backgroundColor: "#090910",
  foregroundColor: "#f5f5f7",
  websiteUrl: "https://zkblast.tech",
  xUrl: "https://x.com/zkblast9",
  logoSha256: null,
  faviconSha256: null,
} as const;
const metadataHash = `0x${createHash("sha256").update(JSON.stringify(branding)).digest("hex")}` as const;
const slugCommitment = keccak256(stringToHex(branding.slug));
const presetId = 1n;
const templateId = 1n;
const latest = await client.getBlock();
const [
  ownerBalance, ownerNonce, usdgDecimals, usdgSymbol, usdgBalance, routerAllowance,
  launchpadCount, slugOwner, presetCount, preset, presetEnabled, quoteAllowed, dammSupported,
  templateCount, templateEconomics, globalFeeCap, factoryRegistry, factoryConfig,
  tokenFactoryRegistry, tokenFactoryConfig, tokenFactoryFee,
] = await Promise.all([
  client.getBalance({ address: owner }),
  client.getTransactionCount({ address: owner, blockTag: "pending" }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "decimals" }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [owner, router] }),
  client.readContract({ address: launchpad.registry!, abi: registryAbi, functionName: "launchpadCount" }),
  client.readContract({ address: launchpad.registry!, abi: registryAbi, functionName: "launchpadBySlug", args: [slugCommitment] }),
  client.readContract({ address: launchpad.configManager!, abi: configAbi, functionName: "presetCount" }),
  client.readContract({ address: launchpad.configManager!, abi: configAbi, functionName: "preset", args: [presetId] }),
  client.readContract({ address: launchpad.configManager!, abi: configAbi, functionName: "isEnabled", args: [presetId] }),
  client.readContract({ address: launchpad.configManager!, abi: configAbi, functionName: "quoteTokenAllowed", args: [usdg] }),
  client.readContract({ address: launchpad.configManager!, abi: configAbi, functionName: "destinationSupported", args: [1] }),
  client.readContract({ address: dbcRegistry, abi: dbcAbi, functionName: "templateCount" }),
  client.readContract({ address: dbcRegistry, abi: dbcAbi, functionName: "templateEconomics", args: [templateId] }),
  client.readContract({ address: launchpad.feeController!, abi: feeAbi, functionName: "globalMaximumTotalTradeFeeBps" }),
  client.readContract({ address: launchpad.factory!, abi: factoryAbi, functionName: "registry" }),
  client.readContract({ address: launchpad.factory!, abi: factoryAbi, functionName: "configManager" }),
  client.readContract({ address: launchpad.tokenFactory!, abi: tokenFactoryAbi, functionName: "registry" }),
  client.readContract({ address: launchpad.tokenFactory!, abi: tokenFactoryAbi, functionName: "configManager" }),
  client.readContract({ address: launchpad.tokenFactory!, abi: tokenFactoryAbi, functionName: "feeController" }),
]);
const codes = await Promise.all(Object.entries({ ...launchpad, dbcRegistry, router, usdg }).map(async ([name, address]) => ({
  name, address, hasCode: Boolean(await client.getCode({ address })),
})));
assert(codes.every(({ hasCode }) => hasCode), "One or more dependencies have no runtime code");
assert.equal(usdgSymbol, "USDG");
assert.equal(usdgDecimals, 6);
assert.equal(slugOwner, 0n, "Canary slug is already registered");
assert.equal(presetCount, 1n);
assert.equal(presetEnabled, true);
assert.equal(quoteAllowed, true);
assert.equal(dammSupported, true);
assert(BigInt(String(templateCount)) >= templateId);
assert.equal(getAddress(String((preset as any).quoteToken)), usdg);
assert.equal(BigInt(String((preset as any).dbcTemplateId)), templateId);
assert.equal(Number((preset as any).graduationDestination), 1);
assert.equal(getAddress(factoryRegistry as Address), launchpad.registry);
assert.equal(getAddress(factoryConfig as Address), launchpad.configManager);
assert.equal(getAddress(tokenFactoryRegistry as Address), launchpad.registry);
assert.equal(getAddress(tokenFactoryConfig as Address), launchpad.configManager);
assert.equal(getAddress(tokenFactoryFee as Address), launchpad.feeController);
const createLaunchpadData = encodeFunctionData({
  abi: factoryAbi,
  functionName: "createLaunchpad",
  args: [owner, owner, metadataHash, slugCommitment, presetId],
});
const createLaunchpadGas = await client.estimateGas({ account: owner, to: launchpad.factory!, data: createLaunchpadData });
const gasPrice = await client.getGasPrice();
const bufferedCreateGas = createLaunchpadGas * 150n / 100n;
const economics = templateEconomics as readonly unknown[];
const plan = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: latest.number.toString(),
  referenceBlockHash: latest.hash,
  owner,
  pendingNonce: ownerNonce,
  launchpadCount: String(launchpadCount),
  predictedLaunchpadId: (BigInt(String(launchpadCount)) + 1n).toString(),
  addresses: { ...launchpad, dbcRegistry, router, usdg },
  branding,
  metadataHash,
  slugCommitment,
  presetId: presetId.toString(),
  templateId: templateId.toString(),
  preset: {
    configHash: (preset as any).configHash,
    maximumTotalTradeFeeBps: Number((preset as any).maximumTotalTradeFeeBps),
    maximumLaunches: Number((preset as any).maximumLaunches),
    creatorAccess: Number((preset as any).creatorAccess),
    graduationDestination: Number((preset as any).graduationDestination),
    used: Boolean((preset as any).used),
  },
  templateEconomics: {
    quoteToken: economics[0],
    totalSupplyRaw: String(economics[1]),
    baseInventoryRaw: String(economics[2]),
    graduationThresholdRaw: String(economics[3]),
    tradeFeeBps: Number(economics[6]),
    creatorLpShareBps: Number(economics[10]),
  },
  balances: {
    ethWei: ownerBalance.toString(),
    eth: formatEther(ownerBalance),
    usdgRaw: usdgBalance.toString(),
    usdg: formatUnits(usdgBalance, usdgDecimals),
    routerAllowanceRaw: routerAllowance.toString(),
    routerAllowance: formatUnits(routerAllowance, usdgDecimals),
  },
  liveEstimate: {
    gasPriceWei: gasPrice.toString(),
    createLaunchpadGas: createLaunchpadGas.toString(),
    bufferedCreateLaunchpadGas: bufferedCreateGas.toString(),
    bufferedCreateLaunchpadFeeWei: (bufferedCreateGas * gasPrice).toString(),
    bufferedCreateLaunchpadFeeEth: formatEther(bufferedCreateGas * gasPrice),
  },
  dependencies: codes,
  sequence: [
    "create-launchpad", "configure-fee-policy", "publish-signed-branding", "create-token",
    "approve-usdg-if-needed", "buy", "sell", "collect-trade-fees", "claim", "graduate-damm",
  ],
  broadcastAllowed: false,
} as const;
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(root, "deployments/mainnet/launchpad-canary-v1-plan.json");
await writeFile(output, serialized);
console.log(JSON.stringify({
  referenceBlock: plan.referenceBlock,
  pendingNonce: ownerNonce,
  predictedLaunchpadId: plan.predictedLaunchpadId,
  ethBalance: plan.balances.eth,
  usdgBalance: plan.balances.usdg,
  graduationThresholdRaw: plan.templateEconomics.graduationThresholdRaw,
  createLaunchpadGas: plan.liveEstimate.createLaunchpadGas,
  createLaunchpadBufferedFeeEth: plan.liveEstimate.bufferedCreateLaunchpadFeeEth,
  planSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
  output,
}));
