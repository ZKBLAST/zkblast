import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  fallback,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex } }>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
);
if (process.env.APP_ENV !== "mainnet" || manifest.chainId !== 4663) {
  throw new Error("ASSISTANCE_FUND_ACTIVATION_CONTEXT_INVALID");
}
const rpcUrl = process.env.RPC_URL?.trim();
if (!rpcUrl) throw new Error("RPC_URL_REQUIRED");

const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const pool = getAddress("0xe6197894d4d4a4e0b1eef50501d1e9c3dd37bd9f");
const protocolToken = getAddress(manifest.assistanceFund.protocolToken);
const quoteAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const collector = getAddress(manifest.assistanceFund.collector);
const registry = getAddress(manifest.assistanceFund.registry);
const routeRegistry = getAddress(manifest.assistanceFund.routeRegistry);
const executor = getAddress(manifest.assistanceFund.executor);
const buybackRouterAdapter = getAddress("0xf166363a18a0755dD7d8b259d59C2bbEebF5c5D8");
const router = getAddress(manifest.integration.swapRouter);
const positionManager = getAddress(manifest.integration.positionManager);
const quoter = getAddress(manifest.integration.poolQuoter);
const feed = getAddress("0x6d57DE017f8Ff7b3EEC8B43581b3F5252654f27A");

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({
  chain,
  transport: fallback(
    [
      rpcUrl,
      "https://robinhood-rpc.publicnode.com",
      "https://robinhood.drpc.org",
      "https://rpc.mainnet.chain.robinhood.com",
    ].map((url) => http(url, { timeout: 30_000, retryCount: 1 })),
    { rank: true, retryCount: 2 },
  ),
});
if ((await client.getChainId()) !== 4663) throw new Error("CHAIN_ID_MISMATCH");

async function artifact(name: string): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(
      path.join(root, "packages/contracts/out-hyperevm", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error(`ARTIFACT_MISSING:${name}`);
  }
  return value;
}
const [oracleBuild, revenueAdapterBuild] = await Promise.all([
  artifact("ManagedFeedReferenceOracle"),
  artifact("AmmProtocolFeeAdapter"),
]);
const [nonce, gasPrice, blockNumber] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getGasPrice(),
  client.getBlockNumber(),
]);
const oracle = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
const revenueAdapter = getContractAddress({ from: deployer, nonce: BigInt(nonce + 1) });
const adapterId0 = keccak256(stringToHex("ZKBLAST_ASSISTANCE_DLMM_PROTOCOL_FEE_TOKEN0_V1"));
const adapterId1 = keccak256(stringToHex("ZKBLAST_ASSISTANCE_DLMM_PROTOCOL_FEE_TOKEN1_V1"));
const routeId = keccak256(stringToHex("ZKBLAST_ASSISTANCE_USDG_TO_ZKBLAST_DLMM_V1"));

const poolAbi = parseAbi([
  "function administrator() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function activeBin() view returns (int24)",
  "function binState(int24) view returns (uint128,uint128,uint256,uint256)",
  "function protocolFeeRecipient() view returns (address)",
  "function protocolFeeSharePips() view returns (uint24)",
  "function setProtocolFeeConfiguration(address,uint24)",
]);
const feedAbi = parseAbi([
  "function reporter() view returns (address)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function submit(int256,uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const positionAbi = parseAbi([
  "function createDlmmPosition(address,int24,uint256,uint256,uint256,uint256) returns (uint256,uint256)",
]);
const routerAbi = parseAbi([
  "function swapDlmmExactInput(address,bool,uint256,uint256,uint16,address,uint256) returns (uint256)",
]);
const quoterAbi = parseAbi([
  "function quoteDlmmExactInput(address,bool,uint256,uint16) view returns (uint256,int24,uint16)",
]);
const registryAbi = parseAbi([
  "function registerSource(address,address,bytes32) returns (bytes32)",
]);
const routeAbi = parseAbi([
  "function configureRoute(bytes32,(address inputAsset,address outputAsset,address pool,address router,address adapter,address oracle,(uint256 minimumAmount,uint256 maximumAmount,uint256 maximumDailySpend,uint128 minimumPoolLiquidity,uint32 cooldownSeconds,uint32 oracleStalenessSeconds,uint32 swapDeadlineSeconds,uint16 maximumSlippageBps,uint16 maximumPriceImpactBps,uint16 maximumOracleDeviationBps) limits,uint8 model,uint8 inputDecimals,uint8 outputDecimals,uint16 minimumOracleObservations,uint16 maximumBinCrossings,bool token0ToToken1,bool enabled))",
]);
const adapterAbi = parseAbi(["function collect() returns (uint256,uint256)"]);
const executorAbi = parseAbi([
  "function executeBuyback(bytes32,uint256,uint256,uint256) returns (uint256)",
]);

const [administrator, token0, token1, activeBin, currentFeeRecipient, currentFeeShare, nextBin, reporter, round, tokenBalance, quoteBalance] = await Promise.all([
  client.readContract({ address: pool, abi: poolAbi, functionName: "administrator" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "activeBin" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "protocolFeeRecipient" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "protocolFeeSharePips" }),
  client.readContract({ address: pool, abi: poolAbi, functionName: "binState", args: [-6462] }),
  client.readContract({ address: feed, abi: feedAbi, functionName: "reporter" }),
  client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
  client.readContract({ address: protocolToken, abi: erc20Abi, functionName: "balanceOf", args: [deployer] }),
  client.readContract({ address: quoteAsset, abi: erc20Abi, functionName: "balanceOf", args: [deployer] }),
]);
if (
  getAddress(administrator) !== deployer || getAddress(token0) !== protocolToken
    || getAddress(token1) !== quoteAsset || activeBin !== -6463
) throw new Error("POOL_CONTEXT_CHANGED");
if (nextBin[2] !== 0n) throw new Error("TARGET_LIQUIDITY_BIN_IS_NOT_EMPTY");

const liquidityTokenRaw = 40_000_000_000_000_000_000n;
const liquidityQuoteRaw = 402_680n;
const pilotSwapRaw = 100_000n;
if (tokenBalance < liquidityTokenRaw || quoteBalance < liquidityQuoteRaw + pilotSwapRaw) {
  throw new Error("ACTIVATION_ASSET_BALANCE_INSUFFICIENT");
}
const now = BigInt(Math.floor(Date.now() / 1_000));
const deadline = now + 3_600n;
const route = {
  inputAsset: quoteAsset,
  outputAsset: protocolToken,
  pool,
  router,
  adapter: buybackRouterAdapter,
  oracle,
  limits: {
    // One raw USDG is entirely consumed by fee rounding and cannot produce a probe quote.
    minimumAmount: 2n,
    maximumAmount: 1_000_000n,
    maximumDailySpend: 1_000_000n,
    minimumPoolLiquidity: 1_000n,
    cooldownSeconds: 300,
    oracleStalenessSeconds: 600,
    swapDeadlineSeconds: 300,
    maximumSlippageBps: 100,
    maximumPriceImpactBps: 500,
    maximumOracleDeviationBps: 1_000,
  },
  model: 1,
  inputDecimals: 6,
  outputDecimals: 18,
  minimumOracleObservations: 2,
  maximumBinCrossings: 2,
  token0ToToken1: false,
  enabled: true,
} as const;

const oracleDeployData = encodeDeployData({
  abi: oracleBuild.abi,
  bytecode: oracleBuild.bytecode.object,
  args: [quoteAsset, protocolToken, feed],
});
const revenueAdapterDeployData = encodeDeployData({
  abi: revenueAdapterBuild.abi,
  bytecode: revenueAdapterBuild.bytecode.object,
  args: [collector, pool, adapterId0, adapterId1],
});
const steps = [
  { signer: "deployer", action: "deploy-reference-oracle", to: null, data: oracleDeployData },
  { signer: "deployer", action: "deploy-revenue-adapter", to: null, data: revenueAdapterDeployData },
  { signer: "safe-2-of-2", action: "register-usdg-fee-source", to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: "registerSource", args: [revenueAdapter, quoteAsset, adapterId1] }) },
  { signer: "safe-2-of-2", action: "configure-buyback-route", to: routeRegistry, data: encodeFunctionData({ abi: routeAbi, functionName: "configureRoute", args: [routeId, route] }) },
  { signer: "deployer", action: "approve-zkblast-liquidity", to: protocolToken, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [positionManager, liquidityTokenRaw] }) },
  { signer: "deployer", action: "approve-usdg-liquidity", to: quoteAsset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [positionManager, liquidityQuoteRaw] }) },
  { signer: "deployer", action: "add-dlmm-liquidity-bin--6462", to: positionManager, data: encodeFunctionData({ abi: positionAbi, functionName: "createDlmmPosition", args: [pool, -6462, liquidityTokenRaw, liquidityQuoteRaw, 1n, deadline] }) },
  { signer: "deployer", action: "set-protocol-fee-10-percent-of-pool-fee", to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: "setProtocolFeeConfiguration", args: [revenueAdapter, 100_000] }) },
  { signer: "reporter", action: "refresh-managed-price", to: feed, data: encodeFunctionData({ abi: feedAbi, functionName: "submit", args: [round[1], now] }) },
  { signer: "deployer", action: "approve-pilot-usdg", to: quoteAsset, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, pilotSwapRaw] }) },
  { signer: "deployer", action: "pilot-usdg-to-zkblast-swap", to: router, data: encodeFunctionData({ abi: routerAbi, functionName: "swapDlmmExactInput", args: [pool, false, pilotSwapRaw, 1n, 2, deployer, deadline] }) },
  { signer: "permissionless", action: "collect-protocol-revenue", to: revenueAdapter, data: encodeFunctionData({ abi: adapterAbi, functionName: "collect" }) },
  { signer: "permissionless", action: "buyback-and-burn-collected-usdg", to: executor, data: encodeFunctionData({ abi: executorAbi, functionName: "executeBuyback", args: [routeId, 29n, 1n, deadline] }) },
] as const;

const deploymentGas = await Promise.all([
  client.estimateGas({ account: deployer, data: oracleDeployData }),
  client.estimateGas({ account: deployer, data: revenueAdapterDeployData }),
]);
const conservativeGas = deploymentGas[0] + deploymentGas[1] + 2_000_000n;
const feeCeilingWei = conservativeGas * gasPrice * 2n;
const body = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  observedBlock: blockNumber.toString(),
  deployer,
  governance,
  startingNonce: nonce,
  predicted: { oracle, revenueAdapter },
  pool: {
    address: pool,
    activeBin,
    targetBin: -6462,
    targetBinPriceX18: nextBin[3].toString(),
    previousFeeRecipient: currentFeeRecipient,
    previousFeeSharePips: currentFeeShare,
    nextFeeSharePips: 100_000,
  },
  assets: {
    liquidityZkblastRaw: liquidityTokenRaw.toString(),
    liquidityUsdgRaw: liquidityQuoteRaw.toString(),
    pilotSwapUsdgRaw: pilotSwapRaw.toString(),
    maximumBuybackUsdgRaw: "1000000",
    expectedPilotProtocolFeeUsdgRaw: "30",
    plannedPilotBuybackUsdgRaw: "29",
  },
  route: { routeId, maximumSlippageBps: 100, maximumDailySpendRaw: "1000000" },
  feed: { address: feed, reporter, currentRound: round[0].toString(), answer: round[1].toString() },
  gas: {
    gasPriceWei: gasPrice.toString(),
    deploymentEstimate: deploymentGas.map(String),
    conservativeTotalGas: conservativeGas.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
    feeCeilingEth: formatEther(feeCeilingWei),
  },
  steps,
  broadcastAllowed: false,
};
const planSha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
const report = { ...body, planSha256 };
const output = path.join(root, "deployments/mainnet/assistance-fund/activation-plan.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  planSha256,
  transactionCount: steps.length,
  predicted: report.predicted,
  feeCeilingEth: report.gas.feeCeilingEth,
  assetLimits: report.assets,
  output: "deployments/mainnet/assistance-fund/activation-plan.json",
  broadcastAllowed: false,
}, null, 2));
