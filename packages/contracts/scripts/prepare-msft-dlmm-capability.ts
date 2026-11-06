import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV_MAINNET_REQUIRED");
const rpcUrl =
  process.env.STOCK_QUOTE_RPC_URL?.trim() ||
  process.env.ROBINHOOD_PUBLIC_RPC_URL?.trim() ||
  process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
type MainnetManifest = Readonly<{
  chainId: number;
  governanceAddress: string;
  deployerAddress: string;
  stockQuoteAssets: {
    canaryAsset: string;
    assetRegistry: string;
    destinationRegistry: string;
    adapterRegistry: string;
  };
  protectedLaunch: { dlmmGraduationAdapter: string };
}>;
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as unknown as MainnetManifest;
assert.equal(manifest.chainId, 4663);

const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663);

const governance = getAddress(manifest.governanceAddress);
const deployer = getAddress(manifest.deployerAddress);
const asset = getAddress(manifest.stockQuoteAssets.canaryAsset);
const assetRegistry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const destinationRegistry = getAddress(
  manifest.stockQuoteAssets.destinationRegistry,
);
const adapterRegistry = getAddress(manifest.stockQuoteAssets.adapterRegistry);
const adapter = getAddress(manifest.protectedLaunch.dlmmGraduationAdapter);
const pool = getAddress("0x0024314B35ed086181Ac57C0C9cb59BC1b1a2957");
const baseToken = getAddress("0x3f9Ff9f1D40369f99c281375bD19D6EcbEbFeCd7");
const poolCreationTx =
  "0xac33b473a8b19359df8d9d894a402d449fd70098184d4e7e21655162eba8b5cf" as Hex;

const erc20Abi = parseAbi([
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
]);
const poolAbi = parseAbi([
  "function factory() view returns(address)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function activeBin() view returns(int24)",
  "function binStepBps() view returns(uint16)",
  "function feePips() view returns(uint24)",
  "function paused() view returns(bool)",
  "function binState(int24) view returns(uint128,uint128,uint256,uint256)",
  "function addLiquidity(int24,uint256,uint256,uint256,address,uint256) returns(uint256)",
]);
const adapterAbi = parseAbi([
  "function manager() view returns(address)",
  "function factory() view returns(address)",
  "function migrationMode() view returns(uint8)",
  "function adapterVersion() view returns(uint32)",
  "function configurationHash() view returns(bytes32)",
]);
const adapterRegistryAbi = parseAbi([
  "function isEnabled(address,uint32) view returns(bool)",
]);
const assetRegistryAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
  "function update(address,(bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const destinationAbi = parseAbi([
  "function capabilityId(address,uint8) view returns(bytes32)",
  "function register(address,address,bytes32) returns(bytes32)",
  "function accept(bytes32,bytes32)",
]);

const activeBin = await client.readContract({
  address: pool,
  abi: poolAbi,
  functionName: "activeBin",
});
const [
  block,
  receipt,
  factory,
  token0,
  token1,
  binStepBps,
  feePips,
  paused,
  binState,
  adapterFactory,
  adapterManager,
  adapterMode,
  adapterVersion,
  adapterConfigurationHash,
  adapterEnabled,
  assetConfig,
  baseBalance,
  quoteBalance,
  capabilityId,
] = await Promise.all([
  client.getBlock(),
  client.getTransactionReceipt({ hash: poolCreationTx }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "factory" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
  client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "binStepBps",
  }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "feePips" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "paused" }),
  client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "binState",
    args: [activeBin],
  }),
  client.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "factory",
  }),
  client.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "manager",
  }),
  client.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "migrationMode",
  }),
  client.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "adapterVersion",
  }),
  client.readContract({
    address: adapter,
    abi: adapterAbi,
    functionName: "configurationHash",
  }),
  client.readContract({
    address: adapterRegistry,
    abi: adapterRegistryAbi,
    functionName: "isEnabled",
    args: [adapter, 1],
  }),
  client.readContract({
    address: assetRegistry,
    abi: assetRegistryAbi,
    functionName: "quoteAssetConfig",
    args: [asset],
  }),
  client.readContract({
    address: baseToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployer],
  }),
  client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployer],
  }),
  client.readContract({
    address: destinationRegistry,
    abi: destinationAbi,
    functionName: "capabilityId",
    args: [asset, 1],
  }),
]);

assert.equal(receipt.status, "success", "POOL_CREATION_TX_REVERTED");
assert.equal(
  getAddress(factory),
  getAddress(adapterFactory),
  "FACTORY_MISMATCH",
);
assert.equal(getAddress(token0), baseToken, "POOL_TOKEN0_MISMATCH");
assert.equal(getAddress(token1), asset, "POOL_TOKEN1_MISMATCH");
assert.equal(paused, false, "POOL_PAUSED");
assert.equal(adapterMode, 1, "ADAPTER_NOT_DLMM");
assert.equal(adapterVersion, 1, "ADAPTER_VERSION_MISMATCH");
assert.equal(adapterEnabled, true, "ADAPTER_NOT_REGISTERED");
assert.equal(assetConfig.enabled, true, "ASSET_DISABLED");
assert.equal(assetConfig.quoteTradingEnabled, true, "TRADING_DISABLED");
assert.equal(
  assetConfig.graduationEnabled,
  false,
  "GRADUATION_ALREADY_ENABLED",
);
assert.equal(binState[0], 0n, "ACCEPTANCE_BIN_ALREADY_FUNDED");
assert.equal(binState[1], 0n, "ACCEPTANCE_BIN_ALREADY_FUNDED");

const baseAmount = 1n * 10n ** 18n;
const quoteAmount = binState[3];
assert(baseBalance >= baseAmount, "INSUFFICIENT_ZKBLAST_ACCEPTANCE_BALANCE");
assert(quoteBalance >= quoteAmount, "INSUFFICIENT_MSFT_ACCEPTANCE_BALANCE");
const reviewReferenceHash = keccak256(
  encodeAbiParameters(
    [
      { type: "string" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
    ],
    [
      "ZKBLAST_MSFT_DLMM_DESTINATION_REVIEW_V1",
      4663n,
      asset,
      adapter,
      adapterConfigurationHash,
    ],
  ),
);
const fundedAcceptanceHash = keccak256(
  encodeAbiParameters(
    [
      { type: "string" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
    ],
    [
      "ZKBLAST_MSFT_DLMM_FUNDED_ACCEPTANCE_V1",
      4663n,
      pool,
      poolCreationTx,
      activeBin,
      baseAmount,
      quoteAmount,
      adapter,
      adapterConfigurationHash,
    ],
  ),
);
const enabledConfig = { ...assetConfig, graduationEnabled: true };
const actions = [
  {
    actor: "deployer",
    name: "approve-zkblast-dlmm-acceptance",
    target: baseToken,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [pool, baseAmount],
    }),
  },
  {
    actor: "deployer",
    name: "approve-msft-dlmm-acceptance",
    target: asset,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [pool, quoteAmount],
    }),
  },
  {
    actor: "deployer",
    name: "fund-msft-dlmm-acceptance",
    target: pool,
    data: encodeFunctionData({
      abi: poolAbi,
      functionName: "addLiquidity",
      args: [activeBin, baseAmount, quoteAmount, 1n, deployer, 2n ** 256n - 1n],
    }),
  },
  {
    actor: "governance",
    name: "enable-msft-graduation-policy",
    target: assetRegistry,
    data: encodeFunctionData({
      abi: assetRegistryAbi,
      functionName: "update",
      args: [asset, enabledConfig],
    }),
  },
  {
    actor: "governance",
    name: "register-msft-dlmm-capability",
    target: destinationRegistry,
    data: encodeFunctionData({
      abi: destinationAbi,
      functionName: "register",
      args: [asset, adapter, reviewReferenceHash],
    }),
  },
  {
    actor: "governance",
    name: "accept-msft-dlmm-capability",
    target: destinationRegistry,
    data: encodeFunctionData({
      abi: destinationAbi,
      functionName: "accept",
      args: [capabilityId, fundedAcceptanceHash],
    }),
  },
] as const;

const unsigned = {
  schemaVersion: 1,
  feature: "msft-stock-quote-dlmm-capability",
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governance,
  deployer,
  asset,
  pool,
  poolCreationTx,
  adapter,
  adapterManager: getAddress(adapterManager),
  adapterFactory: getAddress(adapterFactory),
  adapterVersion: Number(adapterVersion),
  adapterConfigurationHash,
  capabilityId,
  reviewReferenceHash,
  fundedAcceptanceHash,
  acceptance: {
    activeBin: Number(activeBin),
    poolBinStepBps: Number(binStepBps),
    poolFeePips: Number(feePips),
    baseAmountRaw: baseAmount.toString(),
    quoteAmountRaw: quoteAmount.toString(),
    baseBalanceRaw: baseBalance.toString(),
    quoteBalanceRaw: quoteBalance.toString(),
  },
  actions: actions.map((action) => ({
    ...action,
    calldataHash: keccak256(action.data),
  })),
  gates: {
    broadcastAllowed: false,
    requiresExplicitApproval: true,
    graduationEnabledAfterExecution: true,
    dlmmCapabilityEnabledAfterExecution: true,
  },
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "msft-dlmm-capability-plan.json"),
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    planSha256,
    transactionCount: actions.length,
    acceptance: unsigned.acceptance,
    capabilityId,
    fundedAcceptanceHash,
  }),
);
