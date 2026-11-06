import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createTestClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
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
      "deployments/mainnet/stock-quotes/msft-dlmm-capability-plan.json",
    ),
    "utf8",
  ),
) as {
  chainId: number;
  planSha256: string;
  governance: Address;
  deployer: Address;
  asset: Address;
  pool: Address;
  adapter: Address;
  capabilityId: Hex;
  fundedAcceptanceHash: Hex;
  acceptance: { activeBin: number };
  actions: readonly {
    actor: "deployer" | "governance";
    name: string;
    target: Address;
    data: Hex;
  }[];
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
for (const account of [plan.deployer, plan.governance]) {
  await testClient.impersonateAccount({ address: getAddress(account) });
  await testClient.setBalance({
    address: getAddress(account),
    value: 10n ** 18n,
  });
}
await testClient.setNextBlockBaseFeePerGas({ baseFeePerGas: 0n });

const receipts: {
  name: string;
  actor: string;
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
}[] = [];
for (const action of plan.actions) {
  const actor = getAddress(
    action.actor === "deployer" ? plan.deployer : plan.governance,
  );
  const hash = await testClient.sendTransaction({
    account: actor,
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
    actor,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  });
}

const poolAbi = parseAbi([
  "function binState(int24) view returns(uint128,uint128,uint256,uint256)",
  "function sharesOf(int24,address) view returns(uint256)",
]);
const assetAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const destinationAbi = parseAbi([
  "function isEnabled(address,uint8) view returns(bool)",
  "function capability(bytes32) view returns ((uint256 chainId,address quoteAsset,address adapter,address factory,uint32 adapterVersion,uint8 mode,bytes32 adapterConfigurationHash,bytes32 reviewReferenceHash,bytes32 fundedAcceptanceHash,uint64 registeredAt,uint64 acceptedAt,bool enabled))",
]);
type MainnetManifest = Readonly<{
  stockQuoteAssets: {
    assetRegistry: string;
    destinationRegistry: string;
  };
}>;
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as unknown as MainnetManifest;
const [bin, shares, assetConfig, enabled, capability] = await Promise.all([
  publicClient.readContract({
    address: getAddress(plan.pool),
    abi: poolAbi,
    functionName: "binState",
    args: [plan.acceptance.activeBin],
  }),
  publicClient.readContract({
    address: getAddress(plan.pool),
    abi: poolAbi,
    functionName: "sharesOf",
    args: [plan.acceptance.activeBin, getAddress(plan.deployer)],
  }),
  publicClient.readContract({
    address: getAddress(manifest.stockQuoteAssets.assetRegistry),
    abi: assetAbi,
    functionName: "quoteAssetConfig",
    args: [getAddress(plan.asset)],
  }),
  publicClient.readContract({
    address: getAddress(manifest.stockQuoteAssets.destinationRegistry),
    abi: destinationAbi,
    functionName: "isEnabled",
    args: [getAddress(plan.asset), 1],
  }),
  publicClient.readContract({
    address: getAddress(manifest.stockQuoteAssets.destinationRegistry),
    abi: destinationAbi,
    functionName: "capability",
    args: [plan.capabilityId],
  }),
]);
assert(bin[0] > 0n && bin[1] > 0n && bin[2] > 0n, "FUNDED_BIN_MISSING");
assert(shares > 0n, "ACCEPTANCE_SHARES_MISSING");
assert.equal(assetConfig.graduationEnabled, true, "GRADUATION_NOT_ENABLED");
assert.equal(enabled, true, "DLMM_CAPABILITY_NOT_ENABLED");
assert.equal(capability.enabled, true, "CAPABILITY_RECEIPT_DISABLED");
assert.equal(
  capability.fundedAcceptanceHash,
  plan.fundedAcceptanceHash,
  "FUNDED_ACCEPTANCE_HASH_MISMATCH",
);

const totalGasUsed = receipts.reduce(
  (total, receipt) => total + BigInt(receipt.gasUsed),
  0n,
);
const gasPrice = await publicClient.getGasPrice();
const estimatedExecutionFeeWei = totalGasUsed * gasPrice;
const output = {
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
  assertions: {
    reserve0Raw: bin[0].toString(),
    reserve1Raw: bin[1].toString(),
    totalShares: bin[2].toString(),
    deployerShares: shares.toString(),
    graduationEnabled: assetConfig.graduationEnabled,
    dlmmCapabilityEnabled: enabled,
    fundedAcceptanceHash: capability.fundedAcceptanceHash,
  },
  passed: true,
};
await writeFile(
  path.join(
    root,
    "deployments/mainnet/stock-quotes/msft-dlmm-capability-simulation.json",
  ),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output));
