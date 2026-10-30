import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, encodeFunctionData, formatEther, getAddress, http, keccak256,
  parseAbi, stringToHex, type Abi, type Address, type Hex,
} from "viem";

type Pool = { model: "damm" | "dlmm"; address: Address };
type Market = {
  symbol: string; baseAsset: Address; feed: Address | null; maximumAge: number | null;
  oracleKind?: "chainlink" | "managed_alpha"; pools: Pool[];
};
type Catalog = { schemaVersion: number; chainId: number; quote: { symbol: string; address: Address }; markets: Market[] };

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "mainnet", "The canonical all-pool catalog currently targets mainnet only");
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
const catalog = JSON.parse(await readFile(path.join(root, "deployments/mainnet/perps-market-catalog.json"), "utf8")) as Catalog;
assert.equal(catalog.chainId, manifest.chainId, "Catalog chain mismatch");
assert.equal(catalog.quote.symbol, "USDG", "Only USDG collateral is supported");

const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [oracleAbi, registryAbi, fundingAbi] = await Promise.all([
  artifact("ChainlinkOracleAdapter"), artifact("PerpMarketRegistry"), artifact("FundingRateModule"),
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), catalog.chainId, "RPC chain mismatch");
const governance = getAddress(manifest.roles.defaultAdmin);
const block = await client.getBlock();
const gasPrice = await client.getGasPrice();
const seenPools = new Set<string>();
const seenAssets = new Set<string>();

type Action = { name: string; symbol: string; target: Address; data: Hex; calldataHash: Hex; estimatedTargetGas: string; dependent?: boolean };
const actions: Action[] = [];
const marketPlans: Array<Record<string, unknown>> = [];
for (const input of catalog.markets) {
  const symbol = input.symbol.trim().toUpperCase();
  assert(/^[A-Z0-9.]{2,24}$/u.test(symbol), `Invalid symbol ${symbol}`);
  const baseAsset = getAddress(input.baseAsset);
  assert(!seenAssets.has(baseAsset.toLowerCase()), `Duplicate base asset ${baseAsset}`);
  seenAssets.add(baseAsset.toLowerCase());
  assert((await client.getCode({ address: baseAsset })) !== undefined, `${symbol} has no runtime`);
  for (const pool of input.pools) {
    const address = getAddress(pool.address);
    assert(!seenPools.has(address.toLowerCase()), `Duplicate pool ${address}`);
    seenPools.add(address.toLowerCase());
    const code = await client.getCode({ address });
    assert(code && code !== "0x", `${symbol} ${pool.model} pool has no runtime`);
  }

  const marketId = keccak256(stringToHex(`ZKBLAST:PERPS:${symbol}-USD:${catalog.chainId}`));
  const oracleId = keccak256(stringToHex(`ZKBLAST:ORACLE:${symbol}-USD:${catalog.chainId}`));
  let oracle: Record<string, unknown> = { status: "oracle_required" };
  if (input.feed) {
    assert(input.maximumAge && input.maximumAge > 0, `${symbol} maximumAge is required`);
    const feed = getAddress(input.feed);
    const [code, decimals, description, round] = await Promise.all([
      client.getCode({ address: feed }),
      client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
      client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
      client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
    ]);
    assert(code && code !== "0x", `${symbol} feed has no runtime`);
    assert(decimals <= 18, `${symbol} feed decimals exceed adapter limit`);
    const [roundId, answer, , updatedAt, answeredInRound] = round;
    assert(answer > 0n && updatedAt > 0n && updatedAt <= block.timestamp, `${symbol} feed is invalid`);
    assert(answeredInRound >= roundId, `${symbol} feed round is incomplete`);
    const ageSeconds = block.timestamp - updatedAt;
    assert(ageSeconds <= BigInt(input.maximumAge), `${symbol} feed is stale (${ageSeconds}s)`);
    oracle = { status: "validated", kind: input.oracleKind ?? "chainlink", feed, description, decimals, answer: answer.toString(), updatedAt: updatedAt.toString(), ageSeconds: ageSeconds.toString(), maximumAge: input.maximumAge };
    const data = encodeFunctionData({ abi: oracleAbi, functionName: "configureFeed", args: [oracleId, feed, input.maximumAge, true] });
    await client.call({ account: governance, to: manifest.perps.oracle, data });
    const gas = await client.estimateGas({ account: governance, to: manifest.perps.oracle, data });
    actions.push({ name: "configure-feed", symbol, target: getAddress(manifest.perps.oracle), data, calldataHash: keccak256(data), estimatedTargetGas: gas.toString() });
  }

  const registered = await client.readContract({ address: manifest.perps.registry, abi: registryAbi, functionName: "isRegistered", args: [marketId] });
  const config = {
    baseAsset, oracleId, maxOpenInterestUsd: 100_000n, maxSkewUsd: 100_000n,
    maxPositionUsd: 100_000n, minPositionUsd: 50_000n, maxLeverageBps: 20_000,
    maintenanceMarginBps: 1_000, positionFeeBps: 30, liquidationFeeBps: 50,
    maxPriceImpactBps: 100, enabled: false,
  };
  if (!registered) {
    const data = encodeFunctionData({ abi: registryAbi, functionName: "registerMarket", args: [marketId, config] });
    await client.call({ account: governance, to: manifest.perps.registry, data });
    const gas = await client.estimateGas({ account: governance, to: manifest.perps.registry, data });
    actions.push({ name: "register-disabled", symbol, target: getAddress(manifest.perps.registry), data, calldataHash: keccak256(data), estimatedTargetGas: gas.toString() });
    const pauseData = encodeFunctionData({ abi: registryAbi, functionName: "setMarketPaused", args: [marketId, true] });
    actions.push({ name: "pause-after-registration", symbol, target: getAddress(manifest.perps.registry), data: pauseData, calldataHash: keccak256(pauseData), estimatedTargetGas: "55000", dependent: true });
  }
  const fundingData = encodeFunctionData({ abi: fundingAbi, functionName: "configureMarket", args: [marketId, 10] });
  await client.call({ account: governance, to: manifest.perps.funding, data: fundingData });
  const fundingGas = await client.estimateGas({ account: governance, to: manifest.perps.funding, data: fundingData });
  actions.push({ name: "configure-funding-cap", symbol, target: getAddress(manifest.perps.funding), data: fundingData, calldataHash: keccak256(fundingData), estimatedTargetGas: fundingGas.toString() });
  marketPlans.push({ symbol: `${symbol}-PERP`, marketId, oracleId, baseAsset, pools: input.pools, registered, oracle, config });
}

assert.equal(seenPools.size, 11, "Expected every one of the 11 active pools");
assert.equal(seenAssets.size, 10, "Expected 10 unique underlying assets");
const targetGas = actions.reduce((sum, action) => sum + BigInt(action.estimatedTargetGas), 0n);
const safeOverhead = 250_000n * BigInt(actions.length);
const feeCeiling = (targetGas + safeOverhead) * gasPrice * 2n;
const executableCandidates = marketPlans.filter((market) => (market.oracle as any).status === "validated").map((market) => market.symbol);
const oracleRequired = marketPlans.filter((market) => (market.oracle as any).status !== "validated").map((market) => market.symbol);
const output = path.join(root, "deployments/mainnet/perps-all-markets-plan.json");
await writeFile(output, `${JSON.stringify({
  schemaVersion: 1, environment, chainId: catalog.chainId, observedBlock: block.number.toString(),
  governance, workflow: "safe-2-of-2", poolCount: seenPools.size, marketCount: seenAssets.size,
  executableCandidates, oracleRequired, markets: marketPlans, actions,
  gas: { observedPriceWei: gasPrice.toString(), targetEstimate: targetGas.toString(), safeOverhead: safeOverhead.toString(), feeCeilingWei: feeCeiling.toString(), feeCeilingEth: formatEther(feeCeiling) },
  invariants: [
    "all markets are registered disabled and paused", "all market caps total at most 1 USDG OI",
    "missing-oracle markets cannot execute", "AMM spot prices are never authoritative Perps oracles",
    "engine openings and vault positions remain paused", "no token approval, funding or transfer is included",
  ],
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
console.log(JSON.stringify({ poolCount: seenPools.size, marketCount: seenAssets.size, executableCandidates, oracleRequired, actionCount: actions.length, feeCeilingEth: formatEther(feeCeiling), output }));
