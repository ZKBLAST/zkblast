import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { prepareSafeOperation } from "./safe-operation.js";

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
  dbc: { configRegistry: string };
  stockQuoteAssets: {
    canaryAsset: string;
    assetRegistry: string;
    destinationRegistry: string;
  };
}>;
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as unknown as MainnetManifest;
assert.equal(manifest.chainId, 4663);

const artifact = async (name: string): Promise<Abi> => {
  const parsed = JSON.parse(
    await readFile(
      path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
      "utf8",
    ),
  ) as unknown as { abi: Abi };
  return parsed.abi;
};
const registryAbi = await artifact("LaunchConfigRegistry");
const assetRegistryAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const destinationRegistryAbi = parseAbi([
  "function isEnabled(address,uint8) view returns(bool)",
]);
const client = createPublicClient({
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
assert.equal(await client.getChainId(), 4663);

const governance = getAddress(manifest.governanceAddress);
const deployer = getAddress(manifest.deployerAddress);
const registry = getAddress(manifest.dbc.configRegistry);
const asset = getAddress(manifest.stockQuoteAssets.canaryAsset);
const assetRegistry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const destinationRegistry = getAddress(
  manifest.stockQuoteAssets.destinationRegistry,
);
const [block, templateCount, sourceTemplate, assetConfig, dlmmEnabled] =
  await Promise.all([
    client.getBlock(),
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "templateCount",
    }) as Promise<bigint>,
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "templateConfig",
      args: [2n],
    }),
    client.readContract({
      address: assetRegistry,
      abi: assetRegistryAbi,
      functionName: "quoteAssetConfig",
      args: [asset],
    }),
    client.readContract({
      address: destinationRegistry,
      abi: destinationRegistryAbi,
      functionName: "isEnabled",
      args: [asset, 1],
    }),
  ]);
assert(assetConfig.graduationEnabled, "MSFT_GRADUATION_DISABLED");
assert(dlmmEnabled, "MSFT_DLMM_CAPABILITY_DISABLED");

for (let templateId = 1n; templateId <= templateCount; templateId++) {
  const config = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "templateConfig",
    args: [templateId],
  })) as { quoteToken: Address; migrationMode: number };
  assert(
    !(
      getAddress(config.quoteToken) === asset &&
      Number(config.migrationMode) === 1
    ),
    `MSFT_DLMM_TEMPLATE_ALREADY_EXISTS_${templateId}`,
  );
}

const dlmmTemplate = {
  ...(sourceTemplate as object),
  migrationMode: 1,
};
const familyId = keccak256(toHex("ZKBLAST_MSFT_PROTECTED_DLMM_V1"));
const action = {
  name: "create-msft-protected-dlmm-template",
  target: registry,
  data: encodeFunctionData({
    abi: registryAbi,
    functionName: "createTemplate",
    args: [familyId, dlmmTemplate],
  }),
};
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(
  privateKey && /^0x[\da-f]{64}$/iu.test(privateKey),
  "INVALID_DEPLOYER_KEY",
);
const relayer = privateKeyToAccount(privateKey as Hex);
assert.equal(relayer.address, deployer, "DEPLOYER_MISMATCH");
const safeOperation = await prepareSafeOperation(client, {
  chainId: 4663,
  safe: governance,
  to: action.target,
  data: action.data,
  relayer,
});
const [estimatedGas, gasPrice] = await Promise.all([
  client.estimateGas({
    account: relayer,
    to: safeOperation.to,
    data: safeOperation.data,
  }),
  client.getGasPrice(),
]);
const bufferedFeeWei = (estimatedGas * gasPrice * 150n) / 100n;
const unsigned = {
  schemaVersion: 1,
  feature: "msft-stock-quote-dlmm-template",
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  governance,
  registry,
  asset,
  sourceTemplateId: "2",
  proposedTemplateId: (templateCount + 1n).toString(),
  familyId,
  migrationMode: "dlmm",
  action: { ...action, calldataHash: keccak256(action.data) },
  safeNonce: safeOperation.nonce.toString(),
  estimate: {
    gas: estimatedGas.toString(),
    gasPriceWei: gasPrice.toString(),
    bufferedFeeWei: bufferedFeeWei.toString(),
    bufferedFeeEth: formatEther(bufferedFeeWei),
  },
  gates: { broadcastAllowed: false, requiresExplicitApproval: true },
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
const outputDirectory = path.join(root, "deployments/mainnet/stock-quotes");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "msft-dlmm-template-plan.json"),
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    planSha256,
    proposedTemplateId: unsigned.proposedTemplateId,
    safeNonce: unsigned.safeNonce,
    estimate: unsigned.estimate,
  }),
);
