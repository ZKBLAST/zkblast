import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http,
  parseAbi, parseEther, type Abi, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArg, "0.00053", "Unapproved fee cap");
const cap = parseEther(capArg);
const key = (name: string) => {
  const value = process.env[name];
  assert(value && /^0x[0-9a-f]{64}$/iu.test(value), `${name} is invalid`);
  return value as Hex;
};
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
const plan = JSON.parse(await readFile(path.join(root, "deployments/mainnet/perps-all-markets-plan.json"), "utf8")) as any;
assert.equal(plan.chainId, manifest.chainId, "Plan chain mismatch");
assert.equal(plan.poolCount, 11, "Plan does not contain all active pools");
assert.equal(plan.marketCount, 10, "Plan does not contain all unique markets");
assert.equal(plan.actions.length, 37, "Unexpected action count");
assert(BigInt(plan.gas.feeCeilingWei) <= cap, "Planned fee exceeds approved cap");

const chain = defineChain({
  id: manifest.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
assert.equal(await publicClient.getChainId(), manifest.chainId, "RPC chain mismatch");
const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
assert.equal(deployer.address, getAddress(manifest.deployerAddress), "Deployer key mismatch");
const wallet = createWalletClient({ account: deployer, chain, transport });
const safe = getAddress(plan.governance);
const collateral = getAddress(manifest.perps.collateral);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [registryAbi, oracleAbi, engineAbi, vaultAbi] = await Promise.all([
  artifact("PerpMarketRegistry"), artifact("ChainlinkOracleAdapter"), artifact("PerpEngine"), artifact("LiquidityVaultUSDG"),
]);

const fundingAmount = 4_000_000n;
const [deployerBefore, safeBefore, enginePaused, positionsPaused] = await Promise.all([
  publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] }),
  publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
  publicClient.readContract({ address: manifest.perps.engine, abi: engineAbi, functionName: "openingsPaused" }),
  publicClient.readContract({ address: manifest.perps.liquidityVault, abi: vaultAbi, functionName: "positionsPaused" }),
]);
assert(deployerBefore >= fundingAmount, "Deployer does not have 4 USDG");
assert(enginePaused && positionsPaused, "Global Perps safety pauses must be active");

const receipts: TransactionReceipt[] = [];
let spent = 0n;
const record = async (hash: Hex, label: string) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${label} failed`);
  spent += receipt.gasUsed * receipt.effectiveGasPrice;
  assert(spent <= cap, `Actual fee exceeded approved cap after ${label}`);
  receipts.push(receipt);
};

const transferRequest = await publicClient.simulateContract({
  account: deployer, address: collateral, abi: erc20Abi, functionName: "transfer", args: [safe, fundingAmount],
});
assert(transferRequest.result, "USDG transfer simulation failed");
await record(await wallet.writeContract(transferRequest.request), "fund-governance-safe");

for (const [index, action] of plan.actions.entries()) {
  const operation = await prepareSafeOperation(publicClient, {
    chainId: manifest.chainId, safe, to: getAddress(action.target), data: action.data, relayer: deployer,
  });
  const estimatedGas = await publicClient.estimateGas({ account: deployer, to: operation.to, data: operation.data });
  const gasPrice = await publicClient.getGasPrice();
  assert(spent + estimatedGas * gasPrice * 2n <= cap, `Fee guard stopped before action ${index + 1}`);
  await record(
    await wallet.sendTransaction({ account: deployer, to: operation.to, data: operation.data }),
    `${action.symbol}:${action.name}`,
  );
}

for (const market of plan.markets) {
  const [registered, paused] = await Promise.all([
    publicClient.readContract({ address: manifest.perps.registry, abi: registryAbi, functionName: "isRegistered", args: [market.marketId] }),
    publicClient.readContract({ address: manifest.perps.registry, abi: registryAbi, functionName: "isPaused", args: [market.marketId] }),
  ]);
  assert(registered && paused, `${market.symbol} registration state mismatch`);
  const config = await publicClient.readContract({ address: manifest.perps.registry, abi: registryAbi, functionName: "market", args: [market.marketId] }) as any;
  assert.equal(config.enabled, false, `${market.symbol} unexpectedly enabled`);
  if (market.oracle.status === "validated") {
    const feed = await publicClient.readContract({ address: manifest.perps.oracle, abi: oracleAbi, functionName: "feed", args: [market.oracleId] }) as any;
    assert(feed.enabled && getAddress(feed.feed) === getAddress(market.oracle.feed), `${market.symbol} oracle mismatch`);
  }
}
const [deployerAfter, safeAfter] = await Promise.all([
  publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [deployer.address] }),
  publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
]);
assert.equal(deployerBefore - deployerAfter, fundingAmount, "Unexpected deployer USDG delta");
assert.equal(safeAfter - safeBefore, fundingAmount, "Unexpected Safe USDG delta");
console.log(JSON.stringify({
  transactions: receipts.map((receipt) => receipt.transactionHash), transactionCount: receipts.length,
  totalFeeWei: spent.toString(), totalFeeEth: formatEther(spent), capEth: formatEther(cap),
  deployerUsdgAfter: deployerAfter.toString(), safeUsdgAfter: safeAfter.toString(),
  registeredMarkets: plan.marketCount, coveredPools: plan.poolCount, allDisabledAndPaused: true,
}));
