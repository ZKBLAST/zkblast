import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createTestClient,
  formatEther,
  getAddress,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(
  await readFile(
    path.join(
      root,
      "deployments/mainnet/stock-quotes/multi-asset-activation-plan.json",
    ),
    "utf8",
  ),
) as {
  chainId: number;
  planSha256: string;
  governance: Address;
  observations: readonly {
    symbol: string;
    address: Address;
    oracleFresh: boolean;
  }[];
  actions: readonly { name: string; target: Address; data: Hex }[];
};
assert.equal(plan.chainId, 4663);

const rpcUrl = process.env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:18546";
const transport = http(rpcUrl, { timeout: 120_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
assert.equal(await publicClient.getChainId(), 4663, "FORK_CHAIN_ID_MISMATCH");
const testClient = createTestClient({
  chain: foundry,
  mode: "anvil",
  transport,
})
  .extend(publicActions)
  .extend(walletActions);
const governance = getAddress(plan.governance);
await testClient.impersonateAccount({ address: governance });
await testClient.setNextBlockBaseFeePerGas({ baseFeePerGas: 0n });

const receipts: {
  name: string;
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
}[] = [];
for (const action of plan.actions) {
  const hash = await testClient.sendTransaction({
    account: governance,
    to: getAddress(action.target),
    data: action.data,
    gasPrice: 0n,
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(
    receipt.status,
    "success",
    `${action.name.toUpperCase()}_REVERTED`,
  );
  receipts.push({
    name: action.name,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  });
}

const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
const artifact = async (name: string) =>
  (
    JSON.parse(
      await readFile(
        path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    ) as { abi: readonly unknown[] }
  ).abi;
const [assetRegistryAbi, configRegistryAbi] = await Promise.all([
  artifact("StockQuoteAssetRegistry"),
  artifact("LaunchConfigRegistry"),
]);
const enabledAssets = plan.observations.filter((item) => item.oracleFresh);
const assertions = [];
for (const asset of enabledAssets) {
  const address = getAddress(asset.address);
  const [config, quoteAllowed, protectedOnly] = await Promise.all([
    publicClient.readContract({
      address: getAddress(manifest.stockQuoteAssets.assetRegistry),
      abi: assetRegistryAbi as any,
      functionName: "quoteAssetConfig",
      args: [address],
    }) as Promise<any>,
    publicClient.readContract({
      address: getAddress(manifest.dbc.configRegistry),
      abi: configRegistryAbi as any,
      functionName: "quoteTokenAllowed",
      args: [address],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: getAddress(manifest.dbc.configRegistry),
      abi: configRegistryAbi as any,
      functionName: "quoteTokenProtectedOnly",
      args: [address],
    }) as Promise<boolean>,
  ]);
  assert.equal(
    config.enabled ?? config[0],
    true,
    `${asset.symbol}_NOT_ENABLED`,
  );
  assert.equal(
    config.quoteTradingEnabled ?? config[1],
    true,
    `${asset.symbol}_TRADING_DISABLED`,
  );
  assert.equal(
    config.graduationEnabled ?? config[2],
    false,
    `${asset.symbol}_GRADUATION_ENABLED`,
  );
  assert.equal(quoteAllowed, true, `${asset.symbol}_QUOTE_NOT_ALLOWED`);
  assert.equal(protectedOnly, true, `${asset.symbol}_NOT_PROTECTED_ONLY`);
  assertions.push({
    symbol: asset.symbol,
    quoteTradingEnabled: true,
    graduationEnabled: false,
    quoteTokenAllowed: true,
    protectedOnly: true,
  });
}

const totalGasUsed = receipts.reduce(
  (total, receipt) => total + BigInt(receipt.gasUsed),
  0n,
);
const gasPrice = await publicClient.getGasPrice();
const estimatedExecutionFeeWei = totalGasUsed * gasPrice;
const simulation = {
  schemaVersion: 1,
  environment: "mainnet-fork",
  chainId: 4663,
  planSha256: plan.planSha256,
  transactionCount: receipts.length,
  receipts,
  totalGasUsed: totalGasUsed.toString(),
  gasPriceWei: gasPrice.toString(),
  estimatedExecutionFeeWei: estimatedExecutionFeeWei.toString(),
  estimatedExecutionFeeEth: formatEther(estimatedExecutionFeeWei),
  assertions,
  blockedAssets: plan.observations
    .filter((item) => !item.oracleFresh)
    .map((item) => item.symbol),
  passed: true,
};
await writeFile(
  path.join(
    root,
    "deployments/mainnet/stock-quotes/multi-asset-activation-simulation.json",
  ),
  `${JSON.stringify(simulation, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    planSha256: simulation.planSha256,
    transactionCount: simulation.transactionCount,
    totalGasUsed: simulation.totalGasUsed,
    estimatedExecutionFeeEth: simulation.estimatedExecutionFeeEth,
    enabledAssets: assertions.map((item) => item.symbol),
    blockedAssets: simulation.blockedAssets,
    passed: true,
  }),
);
