import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = { abi: Abi; bytecode: { object: Hex } };
const root = path.resolve(import.meta.dirname, "../../..");
if (process.env.APP_ENV !== "testnet" || Number(process.env.CHAIN_ID) !== 46630 || !process.env.RPC_URL) {
  throw new Error("DLMM_CANARY_CONTEXT_INVALID");
}
const manifest = JSON.parse(await readFile(path.join(root, "deployments/testnet/manifest.json"), "utf8")) as {
  chainId: number;
  deployerAddress: Address;
  governanceAddress: Address;
  dbc: {
    configRegistry: Address;
    launchFactory: Address;
    graduationManager: Address;
    dlmmGraduationAdapter: Address;
    lpAllocationEscrow: Address;
  };
};
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
if ((await client.getChainId()) !== 46630 || manifest.chainId !== 46630) throw new Error("DLMM_CANARY_CHAIN_INVALID");
const artifact = async (name: string) => JSON.parse(
  await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
) as Artifact;
const tokenBuild = await artifact("ZkblastTestnetToken");
const registryBuild = await artifact("LaunchConfigRegistry");
const factoryBuild = await artifact("LaunchFactory");
const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const nonce = await client.getTransactionCount({ address: deployer, blockTag: "pending" });
const quoteToken = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
const tokenCreationData = encodeDeployData({
  abi: tokenBuild.abi,
  bytecode: tokenBuild.bytecode.object,
  args: ["ZKBLAST DLMM Canary Quote", "ZKDCQ", deployer, 10n * 10n ** 18n],
});
const templateCount = await client.readContract({
  address: manifest.dbc.configRegistry,
  abi: registryBuild.abi,
  functionName: "templateCount",
}) as bigint;
const templateId = templateCount + 1n;
const emptySegments = Array.from({ length: 16 }, (_, index) => index === 0
  ? { initialPriceX18: 1_000_000_000_000_000n, slopeX18: 1_000_000_000n, saleCapacityX18: 800n * 10n ** 18n }
  : { initialPriceX18: 0n, slopeX18: 0n, saleCapacityX18: 0n });
const template = {
  quoteToken,
  protocolFeeRecipient: governance,
  partnerFeeRecipient: governance,
  protocolLpRecipient: governance,
  quoteDecimals: 18,
  baseDecimals: 18,
  migrationMode: 1,
  destinationFeePips: 3_000,
  terminalPriceToleranceBps: 100,
  totalSupplyRaw: 1_000n * 10n ** 18n,
  baseInventoryRaw: 800n * 10n ** 18n,
  graduationThresholdRaw: 1_000_000_000_000_000n,
  minimumDestinationShares: 1n,
  curve: { segmentCount: 1, segments: emptySegments },
  fees: { tradeFeeBps: 30, creatorShareBps: 5_000, partnerShareBps: 0, protocolShareBps: 5_000 },
  lp: { creatorShareBps: 5_000, protocolShareBps: 5_000, creatorLockSeconds: 300 },
};
const salt = keccak256(toHex(`ZKBLAST_DLMM_CANARY_${nonce}`));
const allowQuoteData = encodeFunctionData({ abi: registryBuild.abi, functionName: "setQuoteToken", args: [quoteToken, true] });
const createTemplateData = encodeFunctionData({
  abi: registryBuild.abi,
  functionName: "createTemplate",
  args: [keccak256(toHex("ZKBLAST_DLMM_CANARY_V1")), template],
});
const createLaunchData = encodeFunctionData({
  abi: factoryBuild.abi,
  functionName: "createLaunch",
  args: [{
    templateId,
    salt,
    name: "ZKBLAST DLMM Canary",
    symbol: "ZKDC",
    metadataURI: "ipfs://zkblast-dlmm-canary-v1",
    creatorTokenRecipient: deployer,
  }],
});
const gasPrice = await client.getGasPrice();
const deploymentGas = await client.estimateGas({ account: deployer, data: tokenCreationData });
const gasCeilings = {
  deployQuoteToken: deploymentGas * 120n / 100n,
  allowQuoteToken: 100_000n,
  createTemplate: 1_000_000n,
  createLaunch: 5_000_000n,
  approveQuote: 100_000n,
  buyToThreshold: 700_000n,
  graduate: 6_000_000n,
  claimProtocolLp: 500_000n,
};
const totalGasCeiling = Object.values(gasCeilings).reduce((sum, value) => sum + value, 0n);
const feeCeilingWei = totalGasCeiling * gasPrice;
const plan = {
  schemaVersion: 1,
  feature: "dbc-dlmm-canary-v1",
  environment: "testnet",
  chainId: 46630,
  referenceBlock: (await client.getBlockNumber()).toString(),
  deployer,
  governance,
  startingNonce: nonce,
  quoteToken,
  quoteTokenSupplyRaw: (10n * 10n ** 18n).toString(),
  graduationThresholdRaw: template.graduationThresholdRaw.toString(),
  templateId: templateId.toString(),
  template,
  salt,
  contracts: manifest.dbc,
  staticActions: [
    { name: "deployQuoteToken", to: null, dataHash: keccak256(tokenCreationData) },
    { name: "allowQuoteToken", to: manifest.dbc.configRegistry, data: allowQuoteData, dataHash: keccak256(allowQuoteData) },
    { name: "createTemplate", to: manifest.dbc.configRegistry, data: createTemplateData, dataHash: keccak256(createTemplateData) },
    { name: "createLaunch", to: manifest.dbc.launchFactory, data: createLaunchData, dataHash: keccak256(createLaunchData) },
  ],
  dynamicActions: ["approveQuote", "buyToThreshold", "graduate", "claimProtocolLp"],
  gasCeilings: Object.fromEntries(Object.entries(gasCeilings).map(([key, value]) => [key, value.toString()])),
  gasPriceWei: gasPrice.toString(),
  totalGasCeiling: totalGasCeiling.toString(),
  feeCeilingWei: feeCeilingWei.toString(),
  authorization: { broadcastAllowed: false, privateKeyRead: false, userActivationIncluded: false },
};
const json = JSON.stringify(plan, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n";
const output = path.join(root, "deployments/testnet/dbc-dlmm-canary-plan.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, json, { mode: 0o644 });
console.log(JSON.stringify({
  referenceBlock: plan.referenceBlock,
  startingNonce: nonce,
  quoteToken,
  templateId: templateId.toString(),
  graduationThreshold: "0.001 ZKDCQ",
  transactionCount: 8,
  feeCeilingWei: feeCeilingWei.toString(),
  planSha256: createHash("sha256").update(json).digest("hex"),
  output,
  broadcastAllowed: false,
}, null, 2));
