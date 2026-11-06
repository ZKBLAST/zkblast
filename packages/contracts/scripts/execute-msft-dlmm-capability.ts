import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/msft-dlmm-capability-plan.json",
);
const journalPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/msft-dlmm-capability-execution.private.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  environment: string;
  chainId: number;
  planSha256: string;
  governance: Address;
  deployer: Address;
  asset: Address;
  pool: Address;
  adapter: Address;
  capabilityId: Hex;
  fundedAcceptanceHash: Hex;
  acceptance: { baseAmountRaw: string; quoteAmountRaw: string };
  actions: readonly {
    actor: "deployer" | "governance";
    name: string;
    target: Address;
    data: Hex;
  }[];
  gates: { broadcastAllowed: false; requiresExplicitApproval: true };
};

const unsigned = { ...plan } as Record<string, unknown>;
delete unsigned.planSha256;
assert.equal(
  createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  plan.planSha256,
  "PLAN_HASH_DRIFT",
);
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV_MAINNET_REQUIRED");
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.actions.length, 6);
assert.deepEqual(
  plan.actions.map(({ actor }) => actor),
  [
    "deployer",
    "deployer",
    "deployer",
    "governance",
    "governance",
    "governance",
  ],
);
assert.equal(plan.gates.broadcastAllowed, false);
assert.equal(plan.gates.requiresExplicitApproval, true);

const confirmedPlan = process.argv
  .find((value) => value.startsWith("--confirm-plan="))
  ?.split("=")[1];
const capArgument = process.argv
  .find((value) => value.startsWith("--cap-eth="))
  ?.split("=")[1];
assert.equal(
  confirmedPlan,
  plan.planSha256,
  "EXACT_PLAN_CONFIRMATION_REQUIRED",
);
assert.equal(capArgument, "0.00005", "UNAPPROVED_FEE_CAP");
const feeCap = parseEther(capArgument);

const rpcUrl =
  process.env.STOCK_QUOTE_RPC_URL?.trim() ||
  process.env.ROBINHOOD_PUBLIC_RPC_URL?.trim() ||
  process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(
  privateKey && /^0x[\da-f]{64}$/iu.test(privateKey),
  "INVALID_DEPLOYER_KEY",
);
const relayer = privateKeyToAccount(privateKey as Hex);
assert.equal(relayer.address, getAddress(plan.deployer), "DEPLOYER_MISMATCH");

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
// Never retry eth_sendRawTransaction automatically: a node can accept the
// transaction and lose the response, which must be recovered by hash/nonce.
const wallet = createWalletClient({
  account: relayer,
  chain,
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
});
assert.equal(await client.getChainId(), 4663);

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
]);
const poolAbi = parseAbi([
  "function activeBin() view returns(int24)",
  "function binState(int24) view returns(uint128,uint128,uint256,uint256)",
  "function sharesOf(int24,address) view returns(uint256)",
]);
const assetRegistryAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const destinationAbi = parseAbi([
  "function capability(bytes32) view returns ((uint256 chainId,address quoteAsset,address adapter,address factory,uint32 adapterVersion,uint8 mode,bytes32 adapterConfigurationHash,bytes32 reviewReferenceHash,bytes32 fundedAcceptanceHash,uint64 registeredAt,uint64 acceptedAt,bool enabled))",
]);

const baseToken = getAddress(plan.actions[0]!.target);
const baseAmount = BigInt(plan.acceptance.baseAmountRaw);
const quoteAmount = BigInt(plan.acceptance.quoteAmountRaw);
const [baseBalance, quoteBalance, activeBin, nativeBalance] = await Promise.all(
  [
    client.readContract({
      address: baseToken,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [relayer.address],
    }),
    client.readContract({
      address: getAddress(plan.asset),
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [relayer.address],
    }),
    client.readContract({
      address: getAddress(plan.pool),
      abi: poolAbi,
      functionName: "activeBin",
    }),
    client.getBalance({ address: relayer.address }),
  ],
);
assert(baseBalance >= baseAmount, "INSUFFICIENT_ZKBLAST_BALANCE");
assert(quoteBalance >= quoteAmount, "INSUFFICIENT_MSFT_BALANCE");
assert(nativeBalance >= feeCap, "INSUFFICIENT_NATIVE_FEE_BALANCE");

type ReceiptRecord = Readonly<{
  name: string;
  transactionHash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;
let journal: { planSha256: string; receipts: ReceiptRecord[] } | undefined;
try {
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  journal = parsed as {
    planSha256: string;
    receipts: ReceiptRecord[];
  };
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (journal)
  assert.equal(journal.planSha256, plan.planSha256, "EXECUTION_PLAN_MISMATCH");
const receipts = [...(journal?.receipts ?? [])];
let spent = receipts.reduce((sum, item) => sum + BigInt(item.totalFeeWei), 0n);
assert(spent <= feeCap, "RECORDED_FEE_EXCEEDS_CAP");

const persist = async (status: "in-progress" | "confirmed") =>
  writeFile(
    journalPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: "mainnet",
        chainId: 4663,
        planSha256: plan.planSha256,
        status,
        capWei: feeCap.toString(),
        receipts,
        totalFeeWei: spent.toString(),
        totalFeeEth: formatEther(spent),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

const record = async (name: string, receipt: TransactionReceipt) => {
  assert.equal(receipt.status, "success", `${name.toUpperCase()}_REVERTED`);
  const transactionFee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += transactionFee;
  assert(spent <= feeCap, `FEE_CAP_EXCEEDED_AFTER_${name.toUpperCase()}`);
  receipts.push({
    name,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: transactionFee.toString(),
  });
  await persist("in-progress");
};

for (const action of plan.actions) {
  if (receipts.some(({ name }) => name === action.name)) continue;
  const transaction =
    action.actor === "deployer"
      ? { to: getAddress(action.target), data: action.data }
      : await prepareSafeOperation(client, {
          chainId: 4663,
          safe: getAddress(plan.governance),
          to: getAddress(action.target),
          data: action.data,
          relayer,
        });
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas({
      account: relayer,
      to: transaction.to,
      data: transaction.data,
    }),
    client.getGasPrice(),
  ]);
  assert(
    spent + (estimatedGas * gasPrice * 150n) / 100n <= feeCap,
    `FEE_GUARD_STOPPED_BEFORE_${action.name.toUpperCase()}`,
  );
  const hash = await wallet.sendTransaction({
    account: relayer,
    to: transaction.to,
    data: transaction.data,
  });
  await record(
    action.name,
    await client.waitForTransactionReceipt({ hash, confirmations: 1 }),
  );
}

const [binState, shares, assetConfig, capability] = await Promise.all([
  client.readContract({
    address: getAddress(plan.pool),
    abi: poolAbi,
    functionName: "binState",
    args: [activeBin],
  }),
  client.readContract({
    address: getAddress(plan.pool),
    abi: poolAbi,
    functionName: "sharesOf",
    args: [activeBin, relayer.address],
  }),
  client.readContract({
    address: getAddress(plan.actions[3]!.target),
    abi: assetRegistryAbi,
    functionName: "quoteAssetConfig",
    args: [getAddress(plan.asset)],
  }),
  client.readContract({
    address: getAddress(plan.actions[4]!.target),
    abi: destinationAbi,
    functionName: "capability",
    args: [plan.capabilityId],
  }),
]);
assert(binState[0] >= baseAmount, "FUNDED_BASE_RESERVE_NOT_OBSERVED");
assert(binState[1] >= quoteAmount, "FUNDED_QUOTE_RESERVE_NOT_OBSERVED");
assert(shares > 0n, "DEPLOYER_LP_SHARES_NOT_OBSERVED");
assert.equal(assetConfig.graduationEnabled, true, "GRADUATION_NOT_ENABLED");
assert.equal(getAddress(capability.adapter), getAddress(plan.adapter));
assert.equal(capability.fundedAcceptanceHash, plan.fundedAcceptanceHash);
assert(capability.acceptedAt > 0n, "CAPABILITY_NOT_ACCEPTED");
assert.equal(capability.enabled, true, "CAPABILITY_NOT_ENABLED");
await persist("confirmed");

console.log(
  JSON.stringify({
    planSha256: plan.planSha256,
    status: "confirmed",
    transactions: receipts.map(({ transactionHash }) => transactionHash),
    transactionCount: receipts.length,
    totalFeeEth: formatEther(spent),
    capEth: formatEther(feeCap),
    dlmmCapabilityEnabled: true,
    graduationEnabled: true,
  }),
);
