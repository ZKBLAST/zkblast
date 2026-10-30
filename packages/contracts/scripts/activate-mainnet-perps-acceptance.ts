import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet");
assert(process.env.RPC_URL && process.env.SUPABASE_DIRECT_DATABASE_URL);
assert.equal(
  process.argv.find((x) => x.startsWith("--cap-eth="))?.split("=")[1],
  "0.0002",
);
const cap = parseEther("0.0002");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
const marketsPlan = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/perps-all-markets-plan.json"),
    "utf8",
  ),
) as any;
const feeds = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/perps-managed-oracles-execution.json"),
    "utf8",
  ),
) as any;
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const reporterKey = process.env.PERPS_RELAYER_PRIVATE_KEY as Hex;
assert(
  /^0x[0-9a-f]{64}$/iu.test(deployerKey) &&
    /^0x[0-9a-f]{64}$/iu.test(reporterKey),
);
const deployer = privateKeyToAccount(deployerKey);
const reporter = privateKeyToAccount(reporterKey);
assert.equal(reporter.address, getAddress(manifest.perps.relayer.address));
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const client = createPublicClient({ transport });
const deployerWallet = createWalletClient({ account: deployer, transport });
const reporterWallet = createWalletClient({ account: reporter, transport });
assert.equal(await client.getChainId(), 4663);
const safe = getAddress(manifest.governanceAddress);
const perps = manifest.perps;
const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
});
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function submit(int256 answer,uint256 observedAt)",
]);
const oracleAbi = parseAbi([
  "function latestPrice(bytes32) view returns ((uint256 value,uint64 updatedAt) price)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function setPaused(bool,bool,bool)",
  "function deposit(uint256,address) returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function positionsPaused() view returns (bool)",
]);
const insuranceAbi = parseAbi([
  "function fund(uint256)",
  "function assets() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function setMarketEnabled(bytes32,bool)",
  "function setMarketPaused(bytes32,bool)",
  "function market(bytes32) view returns ((address baseAsset,bytes32 oracleId,uint128 maxOpenInterestUsd,uint128 maxSkewUsd,uint128 maxPositionUsd,uint128 minPositionUsd,uint32 maxLeverageBps,uint16 maintenanceMarginBps,uint16 positionFeeBps,uint16 liquidationFeeBps,uint16 maxPriceImpactBps,bool enabled))",
  "function isPaused(bytes32) view returns (bool)",
]);
const engineAbi = parseAbi([
  "function setOpeningsPaused(bool)",
  "function openingsPaused() view returns (bool)",
]);
const poolAbi = parseAbi(["function token0() view returns (address)"]);
const quoterAbi = parseAbi([
  "function quoteDlmmExactInput(address,bool,uint256,uint16) view returns (uint256,int24,uint16)",
]);

let spent = 0n;
const receipts: Array<{ step: string; hash: Hex; feeWei: string }> = [];
async function record(step: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert.equal(receipt.status, "success", `${step} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `fee cap exceeded after ${step}`);
  receipts.push({ step, hash, feeWei: fee.toString() });
}
async function guard(gas: bigint, step: string) {
  const price = await client.getGasPrice();
  assert(spent + gas * price * 2n <= cap, `fee guard stopped before ${step}`);
}
async function submitFeed(
  step: string,
  address: Address,
  answer: bigint,
  observedAt: bigint,
) {
  const request = {
    address,
    abi: feedAbi,
    functionName: "submit" as const,
    args: [answer, observedAt] as const,
    account: reporter,
  };
  await client.simulateContract(request);
  const gas = await client.estimateContractGas(request);
  await guard(gas, step);
  await record(
    step,
    await reporterWallet.writeContract({ ...request, chain: null }),
  );
}
async function refreshBounded(
  step: string,
  address: Address,
  target: bigint,
  observedAt: bigint,
) {
  const [, current] = await client.readContract({
    address,
    abi: feedAbi,
    functionName: "latestRoundData",
  });
  let value = current;
  for (let index = 0; value !== target && index < 32; index++) {
    const next =
      target < value
        ? target > (value * 9_000n) / 10_000n
          ? target
          : (value * 9_000n) / 10_000n
        : target < (value * 11_000n) / 10_000n
          ? target
          : (value * 11_000n) / 10_000n;
    assert(next > 0n && next !== value);
    await submitFeed(`${step}-${index + 1}`, address, next, observedAt);
    value = next;
  }
  assert.equal(value, target, `${step} could not reach target`);
}
async function safeTx(step: string, to: Address, data: Hex) {
  const operation = await prepareSafeOperation(client, {
    chainId: 4663,
    safe,
    to,
    data,
    relayer: deployer,
  });
  const gas = await client.estimateGas({
    account: deployer,
    to: operation.to,
    data: operation.data,
  });
  await guard(gas, step);
  await record(
    step,
    await deployerWallet.sendTransaction({
      account: deployer,
      chain: null,
      to: operation.to,
      data: operation.data,
      gas: gas + gas / 5n,
    }),
  );
}

try {
  const [reference] = await sql.unsafe<{ price: string; observed_at: Date }[]>(
    `select p.price::text,p.observed_at from ${process.env.SUPABASE_SCHEMA}.external_market_price_points p
     join ${process.env.SUPABASE_SCHEMA}.external_markets m on m.id=p.market_id
     where m.symbol='PONS' and p.source='reference' order by p.observed_at desc limit 1`,
  );
  assert(
    reference && Date.now() - reference.observed_at.getTime() < 10 * 60_000,
    "PONS reference stale",
  );
  const weth = marketsPlan.markets.find((x: any) => x.symbol === "WETH-PERP");
  const wethPrice = await client.readContract({
    address: perps.oracle,
    abi: oracleAbi,
    functionName: "latestPrice",
    args: [weth.oracleId],
  });
  const ponsTarget =
    (parseUnits(reference.price, 18) * wethPrice.value) / 10n ** 28n;

  const zkPool = getAddress("0xe6197894d4d4a4e0b1eef50501d1e9c3dd37bd9f");
  const token0 = await client.readContract({
    address: zkPool,
    abi: poolAbi,
    functionName: "token0",
  });
  const usdg = getAddress(perps.collateral);
  const amountIn = 100_000n;
  const [zkOut] = await client.readContract({
    address: manifest.integration.poolQuoter,
    abi: quoterAbi,
    functionName: "quoteDlmmExactInput",
    args: [zkPool, token0.toLowerCase() === usdg.toLowerCase(), amountIn, 16],
  });
  const zkTarget = (amountIn * 10n ** 20n) / zkOut;
  const observedAt = (await client.getBlock()).timestamp;
  await refreshBounded(
    "refresh-PONS",
    getAddress(feeds.feeds.PONS),
    ponsTarget,
    observedAt,
  );
  await refreshBounded(
    "refresh-ZKBLAST",
    getAddress(feeds.feeds.ZKBLAST),
    zkTarget,
    observedAt,
  );

  const safeBalance = await client.readContract({
    address: usdg,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [safe],
  });
  assert(safeBalance >= 4_000_000n, "Safe requires 4 USDG");
  await safeTx(
    "unpause-vault-deposits",
    perps.liquidityVault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "setPaused",
      args: [false, false, true],
    }),
  );
  await safeTx(
    "approve-vault",
    usdg,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [perps.liquidityVault, 3_000_000n],
    }),
  );
  await safeTx(
    "fund-vault",
    perps.liquidityVault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "deposit",
      args: [3_000_000n, safe],
    }),
  );
  await safeTx(
    "approve-insurance",
    usdg,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [perps.insuranceFund, 1_000_000n],
    }),
  );
  await safeTx(
    "fund-insurance",
    perps.insuranceFund,
    encodeFunctionData({
      abi: insuranceAbi,
      functionName: "fund",
      args: [1_000_000n],
    }),
  );
  for (const symbol of ["PONS-PERP", "ZKBLAST-PERP", "WETH-PERP"]) {
    const market = marketsPlan.markets.find((x: any) => x.symbol === symbol);
    assert(market, `${symbol} missing`);
    await client.readContract({
      address: perps.oracle,
      abi: oracleAbi,
      functionName: "latestPrice",
      args: [market.oracleId],
    });
    await safeTx(
      `enable-${symbol}`,
      perps.registry,
      encodeFunctionData({
        abi: registryAbi,
        functionName: "setMarketEnabled",
        args: [market.marketId, true],
      }),
    );
    await safeTx(
      `unpause-${symbol}`,
      perps.registry,
      encodeFunctionData({
        abi: registryAbi,
        functionName: "setMarketPaused",
        args: [market.marketId, false],
      }),
    );
  }
  await safeTx(
    "unpause-vault-positions",
    perps.liquidityVault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "setPaused",
      args: [false, false, false],
    }),
  );
  await safeTx(
    "unpause-engine-openings",
    perps.engine,
    encodeFunctionData({
      abi: engineAbi,
      functionName: "setOpeningsPaused",
      args: [false],
    }),
  );

  const evidence = {
    schemaVersion: 1,
    chainId: 4663,
    status: "confirmed",
    markets: ["PONS-PERP", "ZKBLAST-PERP", "WETH-PERP"],
    vaultRaw: "3000000",
    insuranceRaw: "1000000",
    totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent),
    approvedCapEth: "0.0002",
    transactions: receipts,
  };
  await writeFile(
    path.join(root, "deployments/mainnet/perps-acceptance-activation.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
} finally {
  await sql.end();
}
