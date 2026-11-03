import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
  type Address,
} from "viem";

type Plan = Readonly<{
  chainId: number;
  deployer: Address;
  planSha256: string;
  addresses?: Record<string, Address>;
}>;

type Aggregate = Readonly<{
  chainId: number;
  deployer: Address;
  startingNonce: number;
  nextNonce: number;
  transactionCount: number;
  uniquePredictedAddressCount: number;
  planSha256: string;
  segments: ReadonlyArray<Readonly<{ file: string; planSha256: string }>>;
  gates: Readonly<{ broadcastAllowed: boolean }>;
}>;

type Decision = Readonly<{
  chainId: number;
  economics: Readonly<{ approved: boolean; quoteAssetAddress: Address }>;
  capabilities: Readonly<{
    dammActivationApproved: boolean;
    adapterRegistryReviewRecordApproved: boolean;
    dlmmEnabled: boolean;
    zkEnabled: boolean;
  }>;
  riskBoundary: Readonly<{
    freshLivePreflightRequired: boolean;
    broadcastRequiresSeparateApproval: boolean;
    maximumSpendHype: string;
  }>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const rpcUrl = process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const expectedPlanHash = "796f14804049a0b8a24e42d07506a3e2590aa9a788a4120435b00560659a15b3";
const expectedDeployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
const expectedWhype = getAddress("0x5555555555555555555555555555555555555555");
const actualGasUsed = 48_154_670n;
const bufferedGasUnits = 60_193_338n;

if (
  process.env.DEPLOYER_PRIVATE_KEY ||
  process.env.GOVERNANCE_PRIVATE_KEY ||
  process.env.UPGRADER_PRIVATE_KEY
) {
  throw new Error("HYPEREVM_RELEASE_PREFLIGHT_REFUSES_PRIVATE_KEYS");
}

const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(directory, file), "utf8")) as T;

const aggregate = await read<Aggregate>("aggregate-deployment-plan.json");
const decision = await read<Decision>("release-decision.json");
const simulation = await read<{
  sourcePlanSha256: string;
  transactionCount: number;
  totalGasUsed: string;
  suggestedGasLimitWith25PercentBuffer: string;
}>("sequential-simulation.json");
const verification = await read<{
  transactionCount: number;
  totalGasUsed: string;
  codeAddressCount: number;
  proxyRoleChecks: number;
  passed: boolean;
}>("sequential-simulation-verification.json");

if (
  aggregate.chainId !== 999 ||
  aggregate.deployer !== expectedDeployer ||
  aggregate.startingNonce !== 0 ||
  aggregate.nextNonce !== 56 ||
  aggregate.transactionCount !== 56 ||
  aggregate.uniquePredictedAddressCount !== 41 ||
  aggregate.planSha256 !== expectedPlanHash ||
  aggregate.gates.broadcastAllowed
) {
  throw new Error("HYPEREVM_RELEASE_AGGREGATE_INVALID");
}
if (
  decision.chainId !== 999 ||
  !decision.economics.approved ||
  getAddress(decision.economics.quoteAssetAddress) !== expectedWhype ||
  !decision.capabilities.dammActivationApproved ||
  decision.capabilities.adapterRegistryReviewRecordApproved ||
  decision.capabilities.dlmmEnabled ||
  decision.capabilities.zkEnabled ||
  !decision.riskBoundary.freshLivePreflightRequired ||
  !decision.riskBoundary.broadcastRequiresSeparateApproval ||
  decision.riskBoundary.maximumSpendHype !== "0.013"
) {
  throw new Error("HYPEREVM_RELEASE_DECISION_INVALID");
}
if (
  simulation.sourcePlanSha256 !== expectedPlanHash ||
  simulation.transactionCount !== 56 ||
  BigInt(simulation.totalGasUsed) !== actualGasUsed ||
  BigInt(simulation.suggestedGasLimitWith25PercentBuffer) !== bufferedGasUnits ||
  !verification.passed ||
  verification.transactionCount !== 56 ||
  BigInt(verification.totalGasUsed) !== actualGasUsed ||
  verification.codeAddressCount !== 41 ||
  verification.proxyRoleChecks !== 17
) {
  throw new Error("HYPEREVM_RELEASE_SIMULATION_INVALID");
}

const segmentPlans: Plan[] = [];
for (const segment of aggregate.segments) {
  const plan = await read<Plan>(segment.file);
  if (plan.chainId !== 999 || plan.deployer !== expectedDeployer || plan.planSha256 !== segment.planSha256) {
    throw new Error(`HYPEREVM_RELEASE_SEGMENT_INVALID:${segment.file}`);
  }
  segmentPlans.push(plan);
}

const predictedAddresses = segmentPlans
  .flatMap((plan) => Object.values(plan.addresses ?? {}))
  .map((address) => getAddress(address));
const uniqueAddresses = [...new Set(predictedAddresses)];
if (uniqueAddresses.length !== 41) throw new Error("HYPEREVM_RELEASE_ADDRESS_SET_INVALID");

const client = createPublicClient({ transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
const chainId = await client.getChainId();
if (chainId !== 999) throw new Error(`HYPEREVM_RELEASE_CHAIN_MISMATCH:${chainId}`);

const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const [block, nonce, balance, gasPrice, whypeCode, whypeSymbol, whypeDecimals, codes] = await Promise.all([
  client.getBlock(),
  client.getTransactionCount({ address: expectedDeployer, blockTag: "pending" }),
  client.getBalance({ address: expectedDeployer }),
  client.getGasPrice(),
  client.getCode({ address: expectedWhype }),
  client.readContract({ address: expectedWhype, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: expectedWhype, abi: erc20Abi, functionName: "decimals" }),
  Promise.all(uniqueAddresses.map((address) => client.getCode({ address }))),
]);
if (nonce !== 0) throw new Error(`HYPEREVM_RELEASE_NONCE_CHANGED:${nonce}`);
if (!whypeCode || whypeCode === "0x" || whypeSymbol !== "WHYPE" || whypeDecimals !== 18) {
  throw new Error("HYPEREVM_RELEASE_WHYPE_INVALID");
}
const occupied = uniqueAddresses.filter((_, index) => codes[index] && codes[index] !== "0x");
if (occupied.length > 0) throw new Error(`HYPEREVM_RELEASE_PREDICTED_ADDRESS_OCCUPIED:${occupied[0]}`);

const expectedFeeWei = actualGasUsed * gasPrice;
const bufferedFeeWei = bufferedGasUnits * gasPrice;
const approvedCapWei = 13_000_000_000_000_000n;
if (balance < approvedCapWei) throw new Error("HYPEREVM_RELEASE_BALANCE_BELOW_APPROVED_CAP");
if (bufferedFeeWei > approvedCapWei) throw new Error("HYPEREVM_RELEASE_ESTIMATE_EXCEEDS_APPROVED_CAP");

const report = {
  schemaVersion: 1,
  mode: "read-only-live-release-preflight",
  generatedAt: new Date().toISOString(),
  chain: {
    chainId,
    referenceBlock: block.number.toString(),
    referenceBlockHash: block.hash,
    gasPriceWei: gasPrice.toString(),
  },
  deployer: {
    address: expectedDeployer,
    pendingNonce: nonce,
    balanceWei: balance.toString(),
    balanceHype: formatEther(balance),
  },
  plan: {
    sha256: expectedPlanHash,
    transactionCount: 56,
    predictedAddressCount: uniqueAddresses.length,
    occupiedPredictedAddressCount: occupied.length,
  },
  reserveAsset: { address: expectedWhype, symbol: whypeSymbol, decimals: whypeDecimals },
  cost: {
    simulatedGasUsed: actualGasUsed.toString(),
    gasLimitWith25PercentBuffer: bufferedGasUnits.toString(),
    expectedFeeWei: expectedFeeWei.toString(),
    expectedFeeHype: formatEther(expectedFeeWei),
    bufferedFeeWei: bufferedFeeWei.toString(),
    bufferedFeeHype: formatEther(bufferedFeeWei),
    approvedCapWei: approvedCapWei.toString(),
    approvedCapHype: "0.013",
  },
  gates: {
    planIntegrity: true,
    economicsApproved: true,
    sequentialSimulationPassed: true,
    nonceUnchanged: true,
    predictedAddressesEmpty: true,
    balanceCoversApprovedCap: true,
    estimateWithinApprovedCap: true,
    privateKeysRead: false,
    broadcastAllowed: false,
    separateBroadcastApprovalRequired: true,
  },
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(path.join(directory, "release-preflight.json"), serialized, { mode: 0o644 });
console.log(JSON.stringify({
  chainId,
  referenceBlock: report.chain.referenceBlock,
  pendingNonce: nonce,
  balanceHype: report.deployer.balanceHype,
  gasPriceWei: report.chain.gasPriceWei,
  expectedFeeHype: report.cost.expectedFeeHype,
  bufferedFeeHype: report.cost.bufferedFeeHype,
  approvedCapHype: report.cost.approvedCapHype,
  predictedAddressesEmpty: true,
  reportSha256: createHash("sha256").update(serialized).digest("hex"),
  broadcastAllowed: false,
}, null, 2));
