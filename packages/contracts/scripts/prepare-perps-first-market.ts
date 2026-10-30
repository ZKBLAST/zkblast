import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
assert(process.env.PERPS_WETH_ORACLE_FEED, "PERPS_WETH_ORACLE_FEED is required");

const manifest = JSON.parse(
  await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8"),
) as any;
assert(manifest.perps, "Perps deployment is not bound to the manifest");

const artifact = async (file: string): Promise<Abi> =>
  (JSON.parse(
    await readFile(path.join(root, `packages/contracts/out/${file}.sol/${file}.json`), "utf8"),
  ) as { abi: Abi }).abi;
const [oracleAbi, registryAbi, fundingAbi, vaultAbi, insuranceAbi] = await Promise.all([
  artifact("ChainlinkOracleAdapter"),
  artifact("PerpMarketRegistry"),
  artifact("FundingRateModule"),
  artifact("LiquidityVaultUSDG"),
  artifact("InsuranceFund"),
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);
const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");

const governance = getAddress(manifest.roles.defaultAdmin);
const feed = getAddress(process.env.PERPS_WETH_ORACLE_FEED);
const baseAsset = getAddress(process.env.PERPS_WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const marketId = keccak256(stringToHex(`ZKBLAST:PERPS:WETH-USD:${manifest.chainId}`));
const oracleId = keccak256(stringToHex(`ZKBLAST:ORACLE:WETH-USD:${manifest.chainId}`));
const maximumAge = Number(process.env.PERPS_WETH_ORACLE_MAX_AGE_SECONDS ?? "90000");
assert(Number.isSafeInteger(maximumAge) && maximumAge > 0, "Invalid oracle maximum age");

const [feedCode, baseCode, feedDecimals, description, round, block, gasPrice] = await Promise.all([
  client.getCode({ address: feed }),
  client.getCode({ address: baseAsset }),
  client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
  client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
  client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
  client.getBlock(),
  client.getGasPrice(),
]);
assert(feedCode && feedCode !== "0x", "Oracle feed has no runtime code");
assert(baseCode && baseCode !== "0x", "WETH has no runtime code");
assert.equal(description.trim().toUpperCase(), "ETH / USD", "Unexpected oracle description");
assert(feedDecimals <= 18, "Oracle decimals exceed adapter limit");
const [roundId, answer, , updatedAt, answeredInRound] = round;
assert(answer > 0n && updatedAt > 0n, "Oracle returned an invalid price");
assert(answeredInRound >= roundId, "Oracle round is incomplete");
assert(block.timestamp >= updatedAt, "Oracle timestamp is in the future");
const ageSeconds = block.timestamp - updatedAt;
assert(ageSeconds <= BigInt(maximumAge), `Oracle is stale: ${ageSeconds}s`);

const perps = manifest.perps;
const [oracleRole, marketRole, fundingRole] = await Promise.all([
    client.readContract({ address: perps.oracle, abi: oracleAbi, functionName: "ORACLE_ADMIN_ROLE" }),
    client.readContract({ address: perps.registry, abi: registryAbi, functionName: "MARKET_ADMIN_ROLE" }),
    client.readContract({ address: perps.funding, abi: fundingAbi, functionName: "FUNDING_ADMIN_ROLE" }),
  ]);
const roleState = {
  oracle: await client.readContract({
    address: perps.oracle, abi: oracleAbi, functionName: "hasRole", args: [oracleRole, governance],
  }),
  market: await client.readContract({
    address: perps.registry, abi: registryAbi, functionName: "hasRole", args: [marketRole, governance],
  }),
  funding: await client.readContract({
    address: perps.funding, abi: fundingAbi, functionName: "hasRole", args: [fundingRole, governance],
  }),
};
assert(roleState.oracle && roleState.market && roleState.funding, "Governance is missing a market role");

const registered = await client.readContract({
  address: perps.registry, abi: registryAbi, functionName: "isRegistered", args: [marketId],
});
const marketConfig = {
  baseAsset,
  oracleId,
  maxOpenInterestUsd: 1_000_000n,
  maxSkewUsd: 500_000n,
  maxPositionUsd: 250_000n,
  minPositionUsd: 100_000n,
  maxLeverageBps: 20_000,
  maintenanceMarginBps: 1_000,
  positionFeeBps: 30,
  liquidationFeeBps: 50,
  maxPriceImpactBps: 100,
  enabled: false,
};
const candidates = [
  {
    name: "configure-weth-oracle",
    target: getAddress(perps.oracle),
    abi: oracleAbi,
    functionName: "configureFeed",
    args: [oracleId, feed, maximumAge, true] as const,
  },
  ...(!registered ? [{
    name: "register-weth-perp-disabled",
    target: getAddress(perps.registry),
    abi: registryAbi,
    functionName: "registerMarket",
    args: [marketId, marketConfig] as const,
  }] : []),
  {
    name: "configure-weth-funding-cap",
    target: getAddress(perps.funding),
    abi: fundingAbi,
    functionName: "configureMarket",
    args: [marketId, 10] as const,
  },
] as const;

const actions: Array<{
  name: string; target: Address; data: Hex; calldataHash: Hex; estimatedTargetGas: string;
}> = [];
for (const candidate of candidates) {
  const data = encodeFunctionData({
    abi: candidate.abi,
    functionName: candidate.functionName,
    args: candidate.args,
  } as never);
  await client.call({ account: governance, to: candidate.target, data });
  const gas = await client.estimateGas({ account: governance, to: candidate.target, data });
  actions.push({
    name: candidate.name,
    target: candidate.target,
    data,
    calldataHash: keccak256(data),
    estimatedTargetGas: gas.toString(),
  });
}
if (!registered) {
  const data = encodeFunctionData({
    abi: registryAbi, functionName: "setMarketPaused", args: [marketId, true],
  });
  actions.push({
    name: "pause-weth-perp-after-registration",
    target: getAddress(perps.registry),
    data,
    calldataHash: keccak256(data),
    estimatedTargetGas: "55000",
  });
}

const [vaultAssets, insuranceAssets, depositCeiling, depositsPaused, positionsPaused] =
  await Promise.all([
    client.readContract({ address: perps.liquidityVault, abi: vaultAbi, functionName: "totalAssets" }),
    client.readContract({ address: perps.insuranceFund, abi: insuranceAbi, functionName: "assets" }),
    client.readContract({ address: perps.liquidityVault, abi: vaultAbi, functionName: "depositCeiling" }),
    client.readContract({ address: perps.liquidityVault, abi: vaultAbi, functionName: "depositsPaused" }),
    client.readContract({ address: perps.liquidityVault, abi: vaultAbi, functionName: "positionsPaused" }),
  ]);
const collateral = getAddress(perps.collateral);
const [collateralSymbol, collateralDecimals, governanceCollateralBalance] = await Promise.all([
  client.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" }),
  client.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [governance] }),
]);
assert.equal(collateralSymbol, "USDG", "Perps collateral is not USDG");
assert.equal(collateralDecimals, 6, "USDG must have 6 decimals");

const targetGas = actions.reduce((sum, action) => sum + BigInt(action.estimatedTargetGas), 0n);
const governanceOverhead = environment === "mainnet" ? 250_000n * BigInt(actions.length) : 0n;
const feeCeiling = (targetGas + governanceOverhead) * gasPrice * 2n;
const plan = {
  schemaVersion: 1,
  environment,
  chainId: manifest.chainId,
  observedBlock: block.number.toString(),
  governance,
  workflow: environment === "mainnet" ? "safe-2-of-2" : "direct-wallet",
  market: { symbol: "WETH-PERP", marketId, oracleId, config: marketConfig, registered },
  oracle: {
    feed, description, decimals: feedDecimals, answer: answer.toString(),
    updatedAt: updatedAt.toString(), ageSeconds: ageSeconds.toString(), maximumAge,
  },
  roles: roleState,
  actions,
  funding: {
    collateral, symbol: collateralSymbol, decimals: collateralDecimals,
    recommendedLpRaw: "3000000", recommendedInsuranceRaw: "1000000",
    governanceBalanceRaw: governanceCollateralBalance.toString(),
    vaultAssetsRaw: String(vaultAssets), insuranceAssetsRaw: String(insuranceAssets),
    depositCeilingRaw: String(depositCeiling), depositsPaused, positionsPaused,
    includedInThisPlan: false,
  },
  gas: {
    observedPriceWei: gasPrice.toString(), targetEstimate: targetGas.toString(),
    governanceOverhead: governanceOverhead.toString(), feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
  invariants: [
    "WETH-PERP remains disabled and paused after configuration",
    "engine openings and vault positions remain paused",
    "no USDG approval, transfer, LP deposit or insurance funding is included",
    "PONS-PERP and every unapproved market remain unregistered",
  ],
};
const output = path.join(root, `deployments/${environment}/perps-first-market-plan.json`);
await writeFile(output, `${JSON.stringify(plan, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
console.log(JSON.stringify({
  environment, marketId, oracleId, oracleAgeSeconds: ageSeconds.toString(),
  actions: actions.map(({ name }) => name), feeCeilingEth: plan.gas.feeCeilingEth,
  governanceCollateralBalance: governanceCollateralBalance.toString(), output,
}));
