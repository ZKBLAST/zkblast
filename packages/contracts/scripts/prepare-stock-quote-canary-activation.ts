import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");

const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");

const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(manifest.chainId, 4663);
assert(manifest.dbc && manifest.stockQuoteAssets, "STOCK_QUOTE_DEPLOYMENT_REQUIRED");

const artifact = async (name: string): Promise<Abi> =>
  (
    JSON.parse(
      await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
    ) as { abi: Abi }
  ).abi;

const [assetRegistryAbi, oracleGuardAbi, configRegistryAbi, feedAbi] = await Promise.all([
  artifact("StockQuoteAssetRegistry"),
  artifact("StockQuoteOracleGuard"),
  artifact("LaunchConfigRegistry"),
  artifact("IAggregatorV3"),
]);

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663);

const governance = getAddress(manifest.governanceAddress);
const asset = getAddress(manifest.stockQuoteAssets.canaryAsset);
const assetRegistry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const oracleGuard = getAddress(manifest.stockQuoteAssets.oracleGuard);
const configRegistry = getAddress(manifest.dbc.configRegistry);
const block = await client.getBlock();

const currentConfig = (await client.readContract({
  address: assetRegistry,
  abi: assetRegistryAbi,
  functionName: "quoteAssetConfig",
  args: [asset],
})) as any;
const priceFeed = getAddress(currentConfig.priceFeed ?? currentConfig[3]);
const feedObservation = (await client.readContract({
  address: priceFeed,
  abi: feedAbi,
  functionName: "latestRoundData",
})) as readonly [bigint, bigint, bigint, bigint, bigint];
const feedUpdatedAt = feedObservation[3];
assert(feedObservation[0] > 0n && feedObservation[1] > 0n, "INVALID_ORACLE_OBSERVATION");
assert(feedObservation[4] >= feedObservation[0], "INCOMPLETE_ORACLE_ROUND");
assert(block.timestamp >= feedUpdatedAt, "FUTURE_ORACLE_OBSERVATION");
assert(block.timestamp - feedUpdatedAt <= 86_400n, "ORACLE_OBSERVATION_TOO_OLD");

const templateCount = (await client.readContract({
  address: configRegistry,
  abi: configRegistryAbi,
  functionName: "templateCount",
})) as bigint;
const canonicalTemplate = (await client.readContract({
  address: configRegistry,
  abi: configRegistryAbi,
  functionName: "templateConfig",
  args: [1n],
})) as any;

const maximumLaunchNotionalX18 = 5n * 10n ** 18n;
const activationConfig = {
  enabled: true,
  quoteTradingEnabled: true,
  graduationEnabled: false,
  priceFeed,
  tokenDecimals: Number(currentConfig.tokenDecimals ?? currentConfig[4]),
  maxOracleAge: 86_400,
  maxOracleDeviationBps: 500,
  maxLaunchQuoteExposure: maximumLaunchNotionalX18,
  maxPoolQuoteExposure: maximumLaunchNotionalX18,
  issuerAssetId: currentConfig.issuerAssetId ?? currentConfig[9],
} as const;

const template = {
  ...canonicalTemplate,
  quoteToken: asset,
  quoteDecimals: activationConfig.tokenDecimals,
  graduationThresholdRaw: 100_000_000_000_000n,
  minimumDestinationShares: 1n,
  curve: {
    ...canonicalTemplate.curve,
    segments: canonicalTemplate.curve.segments.map((segment: any, index: number) =>
      index === 0
        ? {
            ...segment,
            initialPriceX18: 100_000_000_000n,
            slopeX18: 100_000_000n,
          }
        : segment,
    ),
  },
};

type Action = Readonly<{
  name: string;
  target: Address;
  data: Hex;
  purpose: string;
}>;
const actions: Action[] = [
  {
    name: "enable-capped-msft-quote-trading",
    target: assetRegistry,
    data: encodeFunctionData({
      abi: assetRegistryAbi,
      functionName: "update",
      args: [asset, activationConfig],
    }),
    purpose: "Enable create/buy/sell with a five USD maximum launch notional; graduation remains disabled",
  },
  {
    name: "open-msft-session",
    target: oracleGuard,
    data: encodeFunctionData({
      abi: oracleGuardAbi,
      functionName: "setSessionPolicy",
      args: [asset, 0, 1_000_412_952_576_205_964n, false, feedUpdatedAt],
    }),
    purpose: "Bind the canary to the fresh authenticated oracle observation",
  },
  {
    name: "allow-msft-dbc-quote-token",
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "setQuoteToken",
      args: [asset, true],
    }),
    purpose: "Allow MSFT only through governed DBC templates",
  },
  {
    name: "require-protected-msft-launches",
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "setQuoteTokenProtectedOnly",
      args: [asset, true],
    }),
    purpose: "Prevent MSFT from entering the unguarded launch path",
  },
  {
    name: "create-msft-canary-template",
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "createTemplate",
      args: [keccak256(toHex("ZKBLAST_MSFT_PROTECTED_CANARY_V1")), template],
    }),
    purpose: "Expose one minimal protected MSFT quote template to the launch UI",
  },
];

const unsigned = {
  schemaVersion: 1,
  feature: "stock-quote-assets-ui-canary",
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governance,
  asset,
  priceFeed,
  proposedTemplateId: (templateCount + 1n).toString(),
  oracle: {
    roundId: feedObservation[0].toString(),
    answer: feedObservation[1].toString(),
    updatedAt: feedUpdatedAt.toString(),
    ageSeconds: (block.timestamp - feedUpdatedAt).toString(),
  },
  limits: {
    maximumLaunchNotionalUsd: "5",
    graduationEnabled: false,
    initialBuyRequired: false,
  },
  actions: actions.map((action) => ({
    ...action,
    calldataHash: keccak256(action.data),
  })),
  gates: {
    broadcastAllowed: false,
    graduationAllowed: false,
    requiresFreshSessionAtBroadcast: true,
    requiresExplicitApproval: true,
  },
};
const planSha256 = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "canary-activation-plan.json"),
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);

console.log(
  JSON.stringify({
    planSha256,
    referenceBlock: unsigned.referenceBlock,
    proposedTemplateId: unsigned.proposedTemplateId,
    actionCount: actions.length,
    oracleAgeSeconds: unsigned.oracle.ageSeconds,
    maximumLaunchNotionalUsd: unsigned.limits.maximumLaunchNotionalUsd,
    graduationEnabled: false,
    broadcastAllowed: false,
  }),
);
