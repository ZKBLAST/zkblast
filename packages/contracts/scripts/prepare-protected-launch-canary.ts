import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(manifest.chainId, 4663);
assert(manifest.protectedLaunch && manifest.dbc && manifest.shielded);

const rpc =
  process.env.RPC_BROADCAST_URL?.trim() ||
  (process.env.RPC_FALLBACK_URLS ?? "").split(",").map((value) => value.trim()).find(Boolean) ||
  process.env.RPC_URL?.trim();
assert(rpc, "RPC_URL_REQUIRED");
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), 4663);

const owner = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const policyRegistry = getAddress(manifest.protectedLaunch.policyRegistry);
const factory = getAddress(manifest.protectedLaunch.launchFactory);
const router = getAddress(manifest.protectedLaunch.launchRouter);
const usdg = getAddress(
  manifest.shielded.assets.find((asset: any) => asset.symbol === "USDG").address,
);
const templateRegistry = getAddress(manifest.dbc.configRegistry);
const templateId = 1n;
const policyAbi = parseAbi([
  "function policyCount() view returns (uint256)",
  "function createPolicy((bytes32 familyId,uint32 protectionBlocks,uint16 maxBuyBpsPerTransaction,uint16 maxBuyBpsPerAddress,uint16 initialFeeBps,uint16 baseFeeBps,uint64 lpLockSeconds,bool batchMode) input) returns (uint256)",
]);
const templateAbi = parseAbi([
  "function templateEconomics(uint256 templateId) view returns (address quoteToken,uint128 totalSupplyRaw,uint128 baseInventoryRaw,uint128 graduationThresholdRaw,uint24 destinationFeePips,uint16 terminalPriceToleranceBps,uint16 tradeFeeBps,uint16 creatorFeeShareBps,uint16 partnerFeeShareBps,uint16 protocolFeeShareBps,uint16 creatorLpShareBps,uint32 creatorLockSeconds)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "function launchCount() view returns (uint256)",
  "function createLaunch((uint256 templateId,uint256 policyId,bytes32 salt,uint64 deadline,string name,string symbol,string metadataURI,address creatorTokenRecipient) request) returns (bytes32,address,address)",
]);

const familyId = keccak256(stringToHex("ZKBLAST_PROTECTED_CANARY_V1"));
const policy = {
  familyId,
  protectionBlocks: 5,
  maxBuyBpsPerTransaction: 500,
  maxBuyBpsPerAddress: 1_000,
  initialFeeBps: 100,
  baseFeeBps: 30,
  lpLockSeconds: 300n,
  batchMode: false,
} as const;
const salt = keccak256(stringToHex("ZKBLAST_PROTECTED_CANARY_V1_LAUNCH"));
const deadline = BigInt(Math.floor(Date.now() / 1_000) + 7 * 24 * 60 * 60);
const [latest, policyCount, launchCount, economics, nativeBalance, usdgBalance, usdgDecimals, allowance] =
  await Promise.all([
    client.getBlock(),
    client.readContract({ address: policyRegistry, abi: policyAbi, functionName: "policyCount" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "launchCount" }),
    client.readContract({ address: templateRegistry, abi: templateAbi, functionName: "templateEconomics", args: [templateId] }),
    client.getBalance({ address: owner }),
    client.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: usdg, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [owner, router] }),
  ]);
assert.equal(getAddress(economics[0]), usdg, "TEMPLATE_QUOTE_TOKEN_MISMATCH");
assert.equal(economics[6], policy.baseFeeBps, "POLICY_BASE_FEE_MISMATCH");
const policyId = policyCount + 1n;
const createPolicyData = encodeFunctionData({
  abi: policyAbi,
  functionName: "createPolicy",
  args: [policy],
});
const createLaunchData = encodeFunctionData({
  abi: factoryAbi,
  functionName: "createLaunch",
  args: [{
    templateId,
    policyId,
    salt,
    deadline,
    name: "ZKBLAST Protected Canary",
    symbol: "ZKPC",
    metadataURI: "https://zkblast.tech/metadata/protected-canary-v1.json",
    creatorTokenRecipient: owner,
  }],
});
const policyGas = await client.estimateGas({ account: governance, to: policyRegistry, data: createPolicyData });
const gasPrice = await client.getGasPrice();
const modeledGas = 9_000_000n;
const bufferedGas = modeledGas * 150n / 100n;
const minimumCanaryQuoteRaw = 1_010_000n;
const requiredTopupRaw =
  usdgBalance >= minimumCanaryQuoteRaw ? 0n : minimumCanaryQuoteRaw - usdgBalance;
const planBase = {
  schemaVersion: 1,
  kind: "protected-launch-mainnet-canary",
  environment: "mainnet",
  chainId: 4663,
  referenceBlock: latest.number.toString(),
  referenceBlockHash: latest.hash,
  owner,
  governance,
  addresses: { policyRegistry, factory, router, templateRegistry, usdg },
  templateId: templateId.toString(),
  predictedPolicyId: policyId.toString(),
  currentPolicyCount: policyCount.toString(),
  currentLaunchCount: launchCount.toString(),
  policy: { ...policy, lpLockSeconds: policy.lpLockSeconds.toString() },
  launch: {
    salt,
    deadline: deadline.toString(),
    name: "ZKBLAST Protected Canary",
    symbol: "ZKPC",
    metadataURI: "https://zkblast.tech/metadata/protected-canary-v1.json",
  },
  economics: {
    totalSupplyRaw: economics[1].toString(),
    baseInventoryRaw: economics[2].toString(),
    graduationThresholdRaw: economics[3].toString(),
    quoteDecimals: usdgDecimals,
    destinationFeePips: economics[4],
    terminalPriceToleranceBps: economics[5],
    tradeFeeBps: economics[6],
    creatorLpShareBps: economics[10],
    templateCreatorLockSeconds: economics[11],
  },
  calldata: {
    createPolicy: createPolicyData,
    createLaunch: createLaunchData,
  },
  balances: {
    nativeWei: nativeBalance.toString(),
    native: formatEther(nativeBalance),
    usdgRaw: usdgBalance.toString(),
    usdg: formatUnits(usdgBalance, usdgDecimals),
    routerAllowanceRaw: allowance.toString(),
  },
  liveEstimate: {
    gasPriceWei: gasPrice.toString(),
    createPolicyTargetGas: policyGas.toString(),
    modeledGas: modeledGas.toString(),
    bufferedGas: bufferedGas.toString(),
    bufferedFeeWei: (bufferedGas * gasPrice).toString(),
    bufferedFeeEth: formatEther(bufferedGas * gasPrice),
    minimumCanaryQuoteRaw: minimumCanaryQuoteRaw.toString(),
    minimumCanaryQuote: formatUnits(minimumCanaryQuoteRaw, usdgDecimals),
    requiredTopupRaw: requiredTopupRaw.toString(),
    requiredTopup: formatUnits(requiredTopupRaw, usdgDecimals),
  },
  acceptance: [
    "create-policy-through-governance-safe",
    "create-protected-launch",
    "reject-buy-above-protected-cap",
    "execute-valid-buy-and-sell",
    "reach-graduation-threshold-after-protection-window",
    "graduate-through-reviewed-adapter",
    "reject-creator-lp-principal-claim-before-unlock",
    "claim-creator-lp-principal-after-unlock",
    "reconcile-indexer-api-ui",
  ],
  broadcastAllowed: false,
} as const;
const unsigned = JSON.stringify(planBase);
const plan = {
  ...planBase,
  planSha256: createHash("sha256").update(unsigned).digest("hex"),
};
const output = path.join(root, "deployments/mainnet/protected-launch/canary-plan.json");
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  planSha256: plan.planSha256,
  predictedPolicyId: plan.predictedPolicyId,
  graduationThresholdRaw: plan.economics.graduationThresholdRaw,
  graduationThreshold: formatUnits(BigInt(plan.economics.graduationThresholdRaw), usdgDecimals),
  nativeBalance: plan.balances.native,
  usdgBalance: plan.balances.usdg,
  requiredTopup: plan.liveEstimate.requiredTopup,
  policyTargetGas: plan.liveEstimate.createPolicyTargetGas,
  bufferedFeeEth: plan.liveEstimate.bufferedFeeEth,
  broadcastAllowed: false,
  output,
}, null, 2));
