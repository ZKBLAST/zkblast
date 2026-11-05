import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  fallback,
  formatEther,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/assistance-fund/activation-plan.json");
const journalPath = path.join(root, "deployments/mainnet/assistance-fund/activation-execution.json");
const plan = JSON.parse(await readFile(planPath, "utf8"));
assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.broadcastAllowed, false);
assert.equal(process.argv.includes("--confirm-broadcast"), true, "Explicit broadcast flag required");
const capWei = 150_000_000_000_000n;

const key = process.env.DEPLOYER_PRIVATE_KEY;
const reporterKey = process.env.PERPS_RELAYER_PRIVATE_KEY;
assert(key && /^0x[0-9a-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY_INVALID");
assert(reporterKey && /^0x[0-9a-f]{64}$/iu.test(reporterKey), "REPORTER_PRIVATE_KEY_INVALID");
const account = privateKeyToAccount(key as Hex);
const reporter = privateKeyToAccount(reporterKey as Hex);
assert.equal(account.address, getAddress(plan.deployer), "DEPLOYER_MISMATCH");
assert.equal(reporter.address, getAddress(plan.feed.reporter), "REPORTER_MISMATCH");

const primary = process.env.RPC_URL?.trim();
assert(primary, "RPC_URL_REQUIRED");
const urls = [
  primary,
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://rpc.mainnet.chain.robinhood.com",
];
const transport = fallback(
  urls.map((url) => http(url, { timeout: 30_000, retryCount: 1 })),
  { rank: true, retryCount: 2 },
);
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [primary] } },
});
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const reporterWallet = createWalletClient({ account: reporter, chain, transport });
assert.equal(await client.getChainId(), 4663);

type ReceiptRecord = {
  step: string;
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice: string;
  feeWei: string;
  contractAddress?: Address | null;
};
let journal: { status: string; planSha256: string; transactions: ReceiptRecord[] } = {
  status: "executing",
  planSha256: plan.planSha256,
  transactions: [],
};
try {
  const loaded = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(loaded.planSha256, plan.planSha256, "JOURNAL_PLAN_MISMATCH");
  journal = loaded;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
let spent = journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const has = (step: string) => journal.transactions.some((item) => item.step === step);
const save = async (status = "executing", extra: Record<string, unknown> = {}) => {
  journal.status = status;
  await writeFile(journalPath, `${JSON.stringify({
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    status,
    planSha256: plan.planSha256,
    approvedGasCapWei: capWei.toString(),
    approvedGasCapEth: formatEther(capWei),
    totalFeeWei: spent.toString(),
    totalFeeEth: formatEther(spent),
    assetLimits: plan.assets,
    transactions: journal.transactions,
    ...extra,
  }, null, 2)}\n`);
};
const guard = async (request: { to?: Address; data: Hex; account: Address }) => {
  const [estimate, gasPrice] = await Promise.all([
    client.estimateGas(request),
    client.getGasPrice(),
  ]);
  assert(spent + estimate * gasPrice * 2n <= capWei, "GAS_CAP_GUARD_STOPPED");
  return estimate;
};
const record = async (step: string, hash: Hex) => {
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${step}:REVERTED`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= capWei, "ACTUAL_GAS_CAP_EXCEEDED");
  journal.transactions.push({
    step,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    feeWei: fee.toString(),
    ...(receipt.contractAddress !== undefined ? { contractAddress: receipt.contractAddress } : {}),
  });
  await save();
  return receipt;
};
const direct = async (step: string, to: Address | undefined, data: Hex, useReporter = false) => {
  if (has(step)) return;
  const sender = useReporter ? reporter : account;
  const selectedWallet = useReporter ? reporterWallet : wallet;
  const gas = await guard({ ...(to ? { to } : {}), data, account: sender.address });
  const hash = await selectedWallet.sendTransaction({ ...(to ? { to } : {}), data, gas });
  await record(step, hash);
};
const safe = async (step: string, to: Address, data: Hex) => {
  if (has(step)) return;
  const operation = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.governance),
    to,
    data,
    relayer: account,
  });
  await direct(step, operation.to, operation.data);
};

const codeChecks = await Promise.all([
  client.getCode({ address: getAddress(plan.predicted.oracle) }),
  client.getCode({ address: getAddress(plan.predicted.revenueAdapter) }),
]);
const currentNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
if (!codeChecks[0] && !codeChecks[1]) {
  assert.equal(currentNonce, plan.startingNonce, "DEPLOYER_NONCE_DRIFT");
}

const step = (name: string) => {
  const item = plan.steps.find((candidate: { action: string }) => candidate.action === name);
  assert(item, `PLAN_STEP_MISSING:${name}`);
  return item as { to: Address | null; data: Hex };
};
for (const name of ["deploy-reference-oracle", "deploy-revenue-adapter"] as const) {
  const item = step(name);
  await direct(name, item.to ?? undefined, item.data);
}
assert(await client.getCode({ address: getAddress(plan.predicted.oracle) }), "ORACLE_DEPLOYMENT_MISSING");
assert(await client.getCode({ address: getAddress(plan.predicted.revenueAdapter) }), "ADAPTER_DEPLOYMENT_MISSING");

for (const name of ["register-usdg-fee-source", "configure-buyback-route"] as const) {
  const item = step(name);
  await safe(name, getAddress(item.to!), item.data);
}
for (const name of [
  "approve-zkblast-liquidity",
  "approve-usdg-liquidity",
  "add-dlmm-liquidity-bin--6462",
  "set-protocol-fee-10-percent-of-pool-fee",
] as const) {
  const item = step(name);
  await direct(name, getAddress(item.to!), item.data);
}
{
  const feedAbi = parseAbi(["function submit(int256,uint256)"]);
  const timestamp = BigInt(Math.floor(Date.now() / 1_000));
  const data = encodeFunctionData({
    abi: feedAbi,
    functionName: "submit",
    args: [BigInt(plan.feed.answer), timestamp],
  });
  await direct("refresh-managed-price", getAddress(plan.feed.address), data, true);
}
for (const name of ["approve-pilot-usdg", "pilot-usdg-to-zkblast-swap"] as const) {
  const item = step(name);
  let data = item.data;
  if (name === "pilot-usdg-to-zkblast-swap") {
    const routerAbi = parseAbi([
      "function swapDlmmExactInput(address,bool,uint256,uint256,uint16,address,uint256) returns (uint256)",
    ]);
    data = encodeFunctionData({
      abi: routerAbi,
      functionName: "swapDlmmExactInput",
      args: [getAddress(plan.pool.address), false, BigInt(plan.assets.pilotSwapUsdgRaw), 1n, 2, account.address, BigInt(Math.floor(Date.now() / 1_000) + 300)],
    });
  }
  await direct(name, getAddress(item.to!), data);
}
{
  const item = step("collect-protocol-revenue");
  await direct("collect-protocol-revenue", getAddress(item.to!), item.data);
}
{
  const quoterAbi = parseAbi([
    "function quoteDlmmExactInput(address,bool,uint256,uint16) view returns (uint256,int24,uint16)",
  ]);
  const amountIn = BigInt(plan.assets.plannedPilotBuybackUsdgRaw);
  const [quoted] = await client.readContract({
    address: getAddress("0xeDC71840758Ed9a2891D1BEEe21B414E910C0Ef7"),
    abi: quoterAbi,
    functionName: "quoteDlmmExactInput",
    args: [getAddress(plan.pool.address), false, amountIn, 2],
  });
  // Registry validates the 1% bound exactly; round the minimum up so integer dust
  // cannot make `minimum * 10_000 < quote * 9_900` by a few wei.
  const minimumOut = (quoted * 9_900n + 9_999n) / 10_000n;
  assert(minimumOut > 0n, "BUYBACK_QUOTE_ZERO");
  const executorAbi = parseAbi([
    "function executeBuyback(bytes32,uint256,uint256,uint256) returns (uint256)",
  ]);
  const data = encodeFunctionData({
    abi: executorAbi,
    functionName: "executeBuyback",
    args: [plan.route.routeId, amountIn, minimumOut, BigInt(Math.floor(Date.now() / 1_000) + 300)],
  });
  await direct("buyback-and-burn-collected-usdg", getAddress(plan.steps.at(-1).to), data);
}
await save("confirmed", {
  oracle: plan.predicted.oracle,
  revenueAdapter: plan.predicted.revenueAdapter,
  pool: plan.pool.address,
  routeId: plan.route.routeId,
});
console.log(JSON.stringify({
  status: "confirmed",
  transactions: journal.transactions.length,
  totalFeeEth: formatEther(spent),
  evidence: "deployments/mainnet/assistance-fund/activation-execution.json",
}, null, 2));
