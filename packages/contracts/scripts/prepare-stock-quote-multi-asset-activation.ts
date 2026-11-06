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
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type AssetDefinition = Readonly<{
  symbol: string;
  address: Address;
  feed: Address;
  maximumAge: number;
}>;

const assets: readonly AssetDefinition[] = [
  {
    symbol: "AMD",
    address: "0x86923f96303D656E4Aa86D9d42D1e57ad2023fDc",
    feed: "0x943a29e7aE51A4798823ca9EEd2ED533B2A22C72",
    maximumAge: 259_200,
  },
  {
    symbol: "AMZN",
    address: "0x12F190a9F9D7d37a250758B26824B97cE941bF54",
    feed: "0xd5A1508cED74c084eBF3CBE853e2C968fB2A651c",
    maximumAge: 259_200,
  },
  {
    symbol: "META",
    address: "0xC0d6457C16cc70D6790DD43521c899C87CE02f35",
    feed: "0x7C38C00c30beE9378381E7B6135D7283356d71B1",
    maximumAge: 259_200,
  },
  {
    symbol: "NFLX",
    address: "0xE0444Ef8BF4ED74f74fD73686E2ddf4c1c5591e8",
    feed: "0x3288DC7b5914F984588Fe79e45f8f89CDf8700F4",
    maximumAge: 900,
  },
  {
    symbol: "PLTR",
    address: "0x894E1EC2D74Ffe5AEF8Dc8A9e84686AcCB964F2A",
    feed: "0x820abEDfF239034956B7A9d2F0a331F9F075eB4C",
    maximumAge: 259_200,
  },
  {
    symbol: "TSLA",
    address: "0x322F0929c4625Ed5bad873C95208d54E1C003B2d",
    feed: "0x4a1166a659A55625345e9515B32AdeCEa5547c38",
    maximumAge: 259_200,
  },
];

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
const rpcUrl =
  process.env.STOCK_QUOTE_RPC_URL?.trim() ||
  process.env.ROBINHOOD_PUBLIC_RPC_URL?.trim() ||
  process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");

const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(manifest.chainId, 4663);
assert(
  manifest.dbc && manifest.stockQuoteAssets,
  "STOCK_QUOTE_DEPLOYMENT_REQUIRED",
);

const artifact = async (name: string): Promise<Abi> =>
  (
    JSON.parse(
      await readFile(
        path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    ) as { abi: Abi }
  ).abi;
const [assetRegistryAbi, oracleGuardAbi, configRegistryAbi] = await Promise.all(
  [
    artifact("StockQuoteAssetRegistry"),
    artifact("StockQuoteOracleGuard"),
    artifact("LaunchConfigRegistry"),
  ],
);
const tokenAbi = parseAbi([
  "function uid() view returns (bytes32)",
  "function uiMultiplier() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663);
const block = await client.getBlock();
const governance = getAddress(manifest.governanceAddress);
const assetRegistry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const oracleGuard = getAddress(manifest.stockQuoteAssets.oracleGuard);
const configRegistry = getAddress(manifest.dbc.configRegistry);
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

type Action = Readonly<{
  name: string;
  target: Address;
  data: Hex;
  purpose: string;
}>;
const actions: Action[] = [];
const observations: Record<string, unknown>[] = [];
let nextTemplateId = templateCount + 1n;
for (const definition of assets) {
  const address = getAddress(definition.address);
  const feed = getAddress(definition.feed);
  const [issuerAssetId, multiplierX18, decimals, round] = await Promise.all([
    client.readContract({ address, abi: tokenAbi, functionName: "uid" }),
    client.readContract({
      address,
      abi: tokenAbi,
      functionName: "uiMultiplier",
    }),
    client.readContract({ address, abi: tokenAbi, functionName: "decimals" }),
    client.readContract({
      address: feed,
      abi: feedAbi,
      functionName: "latestRoundData",
    }),
  ]);
  const ageSeconds =
    block.timestamp >= round[3] ? block.timestamp - round[3] : -1n;
  const oracleFresh =
    round[0] > 0n &&
    round[1] > 0n &&
    round[4] >= round[0] &&
    ageSeconds >= 0n &&
    ageSeconds <= BigInt(definition.maximumAge);
  observations.push({
    symbol: definition.symbol,
    address,
    issuerAssetId,
    multiplierX18: multiplierX18.toString(),
    decimals,
    feed,
    roundId: round[0].toString(),
    answer: round[1].toString(),
    updatedAt: round[3].toString(),
    ageSeconds: ageSeconds.toString(),
    maximumAge: definition.maximumAge,
    oracleFresh,
    activationStatus: oracleFresh ? "planned" : "blocked_stale_oracle",
  });
  if (!oracleFresh) continue;

  const maximumExposure = 5n * 10n ** BigInt(decimals);
  const config = {
    enabled: true,
    quoteTradingEnabled: true,
    graduationEnabled: false,
    priceFeed: feed,
    tokenDecimals: decimals,
    maxOracleAge: definition.maximumAge,
    maxOracleDeviationBps: 500,
    maxLaunchQuoteExposure: maximumExposure,
    maxPoolQuoteExposure: maximumExposure,
    issuerAssetId,
  } as const;
  actions.push({
    name: `list-${definition.symbol.toLowerCase()}-stock-quote`,
    target: assetRegistry,
    data: encodeFunctionData({
      abi: assetRegistryAbi,
      functionName: "list",
      args: [address, config],
    }),
    purpose:
      "List the exact issuer-bound token with capped quote trading; graduation remains disabled",
  });
  actions.push({
    name: `open-${definition.symbol.toLowerCase()}-session`,
    target: oracleGuard,
    data: encodeFunctionData({
      abi: oracleGuardAbi,
      functionName: "setSessionPolicy",
      args: [address, 0, multiplierX18, false, round[3]],
    }),
    purpose:
      "Bind execution to the current onchain multiplier and authenticated oracle observation",
  });
  actions.push({
    name: `allow-${definition.symbol.toLowerCase()}-dbc-quote-token`,
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "setQuoteToken",
      args: [address, true],
    }),
    purpose: "Allow the exact token address in governed DBC templates",
  });
  actions.push({
    name: `require-protected-${definition.symbol.toLowerCase()}-launches`,
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "setQuoteTokenProtectedOnly",
      args: [address, true],
    }),
    purpose:
      "Prevent the stock quote token from entering an unprotected launch path",
  });
  const template = {
    ...canonicalTemplate,
    quoteToken: address,
    quoteDecimals: decimals,
    graduationThresholdRaw: 100_000_000_000_000n,
    minimumDestinationShares: 1n,
    curve: {
      ...canonicalTemplate.curve,
      segments: canonicalTemplate.curve.segments.map(
        (segment: any, index: number) =>
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
  actions.push({
    name: `create-${definition.symbol.toLowerCase()}-protected-template`,
    target: configRegistry,
    data: encodeFunctionData({
      abi: configRegistryAbi,
      functionName: "createTemplate",
      args: [
        keccak256(toHex(`ZKBLAST_${definition.symbol}_PROTECTED_V1`)),
        template,
      ],
    }),
    purpose: `Expose protected ${definition.symbol} quote launches as template ${nextTemplateId}`,
  });
  nextTemplateId += 1n;
}

const unsigned = {
  schemaVersion: 1,
  feature: "stock-quote-assets-multi-asset-activation",
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governance,
  limits: { maximumLaunchNotionalUsd: "5", graduationEnabled: false },
  observations,
  actions: actions.map((action) => ({
    ...action,
    calldataHash: keccak256(action.data),
  })),
  gates: {
    broadcastAllowed: false,
    graduationAllowed: false,
    requiresFreshSessionAtBroadcast: true,
    requiresExplicitApproval: true,
    blockedAssets: observations
      .filter((item) => !item.oracleFresh)
      .map((item) => item.symbol),
  },
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "multi-asset-activation-plan.json"),
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    planSha256,
    referenceBlock: unsigned.referenceBlock,
    plannedAssets: observations
      .filter((item) => item.oracleFresh)
      .map((item) => item.symbol),
    blockedAssets: unsigned.gates.blockedAssets,
    actionCount: actions.length,
    broadcastAllowed: false,
  }),
);
