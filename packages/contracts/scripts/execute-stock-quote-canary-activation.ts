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
  "deployments/mainnet/stock-quotes/canary-activation-plan.json",
);
const executionPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/canary-activation-execution.private.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  environment: string;
  chainId: number;
  planSha256: string;
  governance: Address;
  asset: Address;
  proposedTemplateId: string;
  oracle: { updatedAt: string };
  actions: readonly { name: string; target: Address; data: Hex }[];
  gates: { broadcastAllowed: false; graduationAllowed: false };
};
const unsigned = { ...plan } as Record<string, unknown>;
delete unsigned.planSha256;
assert.equal(
  createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  plan.planSha256,
  "PLAN_HASH_DRIFT",
);
assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.actions.length, 5);
assert.deepEqual(plan.actions.map(({ name }) => name), [
  "enable-capped-msft-quote-trading",
  "open-msft-session",
  "allow-msft-dbc-quote-token",
  "require-protected-msft-launches",
  "create-msft-canary-template",
]);
assert.equal(plan.gates.broadcastAllowed, false);
assert.equal(plan.gates.graduationAllowed, false);

const confirmedPlan = process.argv
  .find((value) => value.startsWith("--confirm-plan="))
  ?.split("=")[1];
const capArg = process.argv
  .find((value) => value.startsWith("--cap-eth="))
  ?.split("=")[1];
assert.equal(confirmedPlan, plan.planSha256, "EXACT_PLAN_CONFIRMATION_REQUIRED");
assert.equal(capArg, "0.00008", "UNAPPROVED_FEE_CAP");
const cap = parseEther(capArg);

const rpcUrl = process.env.STOCK_QUOTE_RPC_URL?.trim() || process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(privateKey && /^0x[\da-f]{64}$/iu.test(privateKey), "INVALID_DEPLOYER_KEY");
const relayer = privateKeyToAccount(privateKey as Hex);

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const transport = http(rpcUrl, { timeout: 30_000, retryCount: 2 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: relayer, chain, transport });
assert.equal(await client.getChainId(), 4663);
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(relayer.address, getAddress(manifest.deployerAddress), "RELAYER_MISMATCH");
assert.equal(getAddress(plan.governance), getAddress(manifest.governanceAddress));
assert(
  BigInt(Math.floor(Date.now() / 1_000)) - BigInt(plan.oracle.updatedAt) <= 86_400n,
  "PLAN_SESSION_OBSERVATION_STALE",
);

type ReceiptRecord = Readonly<{
  name: string;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;
let existing: { planSha256: string; receipts: ReceiptRecord[] } | undefined;
try {
  existing = JSON.parse(await readFile(executionPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (existing)
  assert.equal(existing.planSha256, plan.planSha256, "EXECUTION_PLAN_MISMATCH");
const receipts = [...(existing?.receipts ?? [])];
let spent = receipts.reduce((total, item) => total + BigInt(item.totalFeeWei), 0n);
assert(spent <= cap, "RECORDED_FEE_EXCEEDS_CAP");

const persist = async (status: string) =>
  writeFile(
    executionPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: "mainnet",
        chainId: 4663,
        planSha256: plan.planSha256,
        status,
        capWei: cap.toString(),
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
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  spent += fee;
  assert(spent <= cap, `FEE_CAP_EXCEEDED_AFTER_${name.toUpperCase()}`);
  receipts.push({
    name,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: fee.toString(),
  });
  await persist("in-progress");
};

const initialSafeNonce = 127n;
for (const [index, action] of plan.actions.entries()) {
  if (receipts.some((receipt) => receipt.name === action.name)) continue;
  const operation = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.governance),
    to: getAddress(action.target),
    data: action.data,
    relayer,
  });
  assert.equal(
    operation.nonce,
    initialSafeNonce + BigInt(index),
    `SAFE_NONCE_DRIFT_BEFORE_${action.name.toUpperCase()}`,
  );
  const estimatedGas = await client.estimateGas({
    account: relayer,
    to: operation.to,
    data: operation.data,
  });
  const gasPrice = await client.getGasPrice();
  assert(
    spent + (estimatedGas * gasPrice * 150n) / 100n <= cap,
    `FEE_GUARD_STOPPED_BEFORE_${action.name.toUpperCase()}`,
  );
  const hash = await wallet.sendTransaction({
    account: relayer,
    to: operation.to,
    data: operation.data,
  });
  await record(
    action.name,
    await client.waitForTransactionReceipt({ hash, confirmations: 1 }),
  );
}

const artifact = async (name: string) =>
  JSON.parse(
    await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8"),
  ).abi;
const [assetAbi, oracleAbi, configAbi] = await Promise.all([
  artifact("StockQuoteAssetRegistry"),
  artifact("StockQuoteOracleGuard"),
  artifact("LaunchConfigRegistry"),
]);
const [config, session, allowed, protectedOnly, template] = await Promise.all([
  client.readContract({
    address: getAddress(manifest.stockQuoteAssets.assetRegistry),
    abi: assetAbi,
    functionName: "quoteAssetConfig",
    args: [plan.asset],
  }) as Promise<any>,
  client.readContract({
    address: getAddress(manifest.stockQuoteAssets.oracleGuard),
    abi: oracleAbi,
    functionName: "sessionPolicy",
    args: [plan.asset],
  }) as Promise<any>,
  client.readContract({
    address: getAddress(manifest.dbc.configRegistry),
    abi: configAbi,
    functionName: "quoteTokenAllowed",
    args: [plan.asset],
  }) as Promise<boolean>,
  client.readContract({
    address: getAddress(manifest.dbc.configRegistry),
    abi: configAbi,
    functionName: "quoteTokenProtectedOnly",
    args: [plan.asset],
  }) as Promise<boolean>,
  client.readContract({
    address: getAddress(manifest.dbc.configRegistry),
    abi: configAbi,
    functionName: "templateConfig",
    args: [BigInt(plan.proposedTemplateId)],
  }) as Promise<any>,
]);
assert.equal(config.enabled ?? config[0], true);
assert.equal(config.quoteTradingEnabled ?? config[1], true);
assert.equal(config.graduationEnabled ?? config[2], false);
assert.equal(Number(session.state ?? session[0]), 0);
assert.equal(allowed, true);
assert.equal(protectedOnly, true);
assert.equal(getAddress(template.quoteToken ?? template[0]), getAddress(plan.asset));
await persist("verified");
console.log(
  JSON.stringify({
    planSha256: plan.planSha256,
    status: "verified",
    transactions: receipts.map(({ transactionHash }) => transactionHash),
    transactionCount: receipts.length,
    totalFeeEth: formatEther(spent),
    capEth: formatEther(cap),
    templateId: plan.proposedTemplateId,
    quoteTradingEnabled: true,
    graduationEnabled: false,
  }),
);
