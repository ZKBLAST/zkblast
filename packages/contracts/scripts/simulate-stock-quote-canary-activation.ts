import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createTestClient,
  getAddress,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/canary-activation-plan.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  chainId: number;
  planSha256: string;
  governance: Address;
  asset: Address;
  proposedTemplateId: string;
  actions: readonly { name: string; target: Address; data: Hex }[];
};
assert.equal(plan.chainId, 4663);

const rpcUrl = process.env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:18546";
const transport = http(rpcUrl, { timeout: 120_000, retryCount: 1 });
const publicClient = createPublicClient({ transport });
assert.equal(await publicClient.getChainId(), 4663, "FORK_CHAIN_ID_MISMATCH");
const testClient = createTestClient({ chain: foundry, mode: "anvil", transport })
  .extend(publicActions)
  .extend(walletActions);
const governance = getAddress(plan.governance);
await testClient.impersonateAccount({ address: governance });
await testClient.setBalance({ address: governance, value: 1_000n * 10n ** 18n });
await testClient.setNextBlockBaseFeePerGas({ baseFeePerGas: 0n });
assert.equal(await publicClient.getBalance({ address: governance }), 1_000n * 10n ** 18n);

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
  assert.equal(receipt.status, "success", `${action.name.toUpperCase()}_REVERTED`);
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
  JSON.parse(
    await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
  ).abi;
const [assetRegistryAbi, oracleGuardAbi, configRegistryAbi] = await Promise.all([
  artifact("StockQuoteAssetRegistry"),
  artifact("StockQuoteOracleGuard"),
  artifact("LaunchConfigRegistry"),
]);
const assetRegistry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const oracleGuard = getAddress(manifest.stockQuoteAssets.oracleGuard);
const configRegistry = getAddress(manifest.dbc.configRegistry);
const templateId = BigInt(plan.proposedTemplateId);
const [config, session, quoteAllowed, protectedOnly, template] = await Promise.all([
  publicClient.readContract({
    address: assetRegistry,
    abi: assetRegistryAbi,
    functionName: "quoteAssetConfig",
    args: [plan.asset],
  }) as Promise<any>,
  publicClient.readContract({
    address: oracleGuard,
    abi: oracleGuardAbi,
    functionName: "sessionPolicy",
    args: [plan.asset],
  }) as Promise<any>,
  publicClient.readContract({
    address: configRegistry,
    abi: configRegistryAbi,
    functionName: "quoteTokenAllowed",
    args: [plan.asset],
  }) as Promise<boolean>,
  publicClient.readContract({
    address: configRegistry,
    abi: configRegistryAbi,
    functionName: "quoteTokenProtectedOnly",
    args: [plan.asset],
  }) as Promise<boolean>,
  publicClient.readContract({
    address: configRegistry,
    abi: configRegistryAbi,
    functionName: "templateConfig",
    args: [templateId],
  }) as Promise<any>,
]);

assert.equal(config.enabled ?? config[0], true);
assert.equal(config.quoteTradingEnabled ?? config[1], true);
assert.equal(config.graduationEnabled ?? config[2], false);
assert.equal(Number(session.state ?? session[0]), 0);
assert.equal(quoteAllowed, true);
assert.equal(protectedOnly, true);
assert.equal(getAddress(template.quoteToken ?? template[0]), getAddress(plan.asset));

const totalGasUsed = receipts.reduce((total, receipt) => total + BigInt(receipt.gasUsed), 0n);
const gasPrice = await publicClient.getGasPrice();
const simulation = {
  schemaVersion: 1,
  environment: "mainnet-fork",
  chainId: 4663,
  planSha256: plan.planSha256,
  transactionCount: receipts.length,
  receipts,
  totalGasUsed: totalGasUsed.toString(),
  gasPriceWei: gasPrice.toString(),
  estimatedExecutionFeeWei: (totalGasUsed * gasPrice).toString(),
  assertions: {
    quoteTradingEnabled: true,
    graduationEnabled: false,
    marketState: "active",
    quoteTokenAllowed: true,
    protectedOnly: true,
    templateId: templateId.toString(),
  },
  passed: true,
};
await writeFile(
  path.join(root, "deployments/mainnet/stock-quotes/canary-activation-simulation.json"),
  `${JSON.stringify(simulation, null, 2)}\n`,
);
console.log(JSON.stringify(simulation));
