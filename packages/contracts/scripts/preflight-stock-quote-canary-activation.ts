import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/stock-quotes/canary-activation-plan.json"),
    "utf8",
  ),
) as {
  chainId: number;
  planSha256: string;
  governance: Address;
  asset: Address;
  priceFeed: Address;
  oracle: { roundId: string; updatedAt: string };
  actions: readonly { name: string; target: Address; data: Hex }[];
};
assert.equal(plan.chainId, 4663);
assert.equal(plan.actions.length, 5);

const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663);

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);
const safeAbi = parseAbi(["function nonce() view returns (uint256)"]);
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
const deployer = getAddress(manifest.deployerAddress);
const block = await client.getBlock();
const [gasPrice, deployerBalance, assetBalance, safeNonce, feed] = await Promise.all([
  client.getGasPrice(),
  client.getBalance({ address: deployer }),
  client.readContract({
    address: getAddress(plan.asset),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deployer],
  }),
  client.readContract({
    address: getAddress(plan.governance),
    abi: safeAbi,
    functionName: "nonce",
  }),
  client.readContract({
    address: getAddress(plan.priceFeed),
    abi: feedAbi,
    functionName: "latestRoundData",
  }),
]);
assert(feed[0] > 0n && feed[1] > 0n && feed[4] >= feed[0], "INVALID_ORACLE");
assert(block.timestamp >= feed[3], "FUTURE_ORACLE");
assert(block.timestamp - feed[3] <= 86_400n, "STALE_ORACLE");

const individuallyCallable = await Promise.all(
  plan.actions.slice(0, 3).map(async (action) => {
    await client.call({
      account: getAddress(plan.governance),
      to: getAddress(action.target),
      data: action.data,
    });
    return action.name;
  }),
);

// Includes conservative Safe overhead and the measured 421,695-gas template
// creation from the existing DBC canary receipt. This is a ceiling, not a quote.
const gasCeiling = 2_100_000n;
const estimatedMaximumFeeWei = gasCeiling * gasPrice;
const preflight = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  planSha256: plan.planSha256,
  referenceBlock: block.number.toString(),
  safeNonce: safeNonce.toString(),
  actionCount: plan.actions.length,
  individuallyCallable,
  oracle: {
    roundId: feed[0].toString(),
    answer: feed[1].toString(),
    updatedAt: feed[3].toString(),
    ageSeconds: (block.timestamp - feed[3]).toString(),
  },
  funding: {
    deployerBalanceWei: deployerBalance.toString(),
    deployerBalanceEth: formatEther(deployerBalance),
    stockAssetBalanceRaw: assetBalance.toString(),
    stockAssetRequiredForCreateOnly: "0",
    stockAssetRequiredForBuySell: ">0",
  },
  gas: {
    gasPriceWei: gasPrice.toString(),
    conservativeGasCeiling: gasCeiling.toString(),
    estimatedMaximumFeeWei: estimatedMaximumFeeWei.toString(),
    estimatedMaximumFeeEth: formatEther(estimatedMaximumFeeWei),
    proposedApprovalCapEth: "0.00008",
  },
  checks: {
    chain: true,
    governanceCalls: true,
    oracleFresh: true,
    createLaunchCanBeFundless: true,
    buySellFunded: assetBalance > 0n,
    forkSimulationComplete: false,
  },
  broadcastAllowed: false,
};
await writeFile(
  path.join(root, "deployments/mainnet/stock-quotes/canary-activation-preflight.json"),
  `${JSON.stringify(preflight, null, 2)}\n`,
);
console.log(JSON.stringify(preflight));
