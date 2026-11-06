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
  "deployments/mainnet/stock-quotes/multi-asset-activation-plan.json",
);
const executionPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/multi-asset-activation-execution.private.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  environment: string;
  chainId: number;
  planSha256: string;
  governance: Address;
  observations: readonly {
    symbol: string;
    address: Address;
    issuerAssetId: Hex;
    multiplierX18: string;
    feed: Address;
    maximumAge: number;
    oracleFresh: boolean;
  }[];
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
assert.equal(plan.actions.length, 25);
assert.deepEqual(
  plan.observations
    .filter((item) => item.oracleFresh)
    .map((item) => item.symbol),
  ["AMD", "AMZN", "META", "PLTR", "TSLA"],
);
assert.deepEqual(
  plan.observations
    .filter((item) => !item.oracleFresh)
    .map((item) => item.symbol),
  ["NFLX"],
);
assert.equal(plan.gates.broadcastAllowed, false);
assert.equal(plan.gates.graduationAllowed, false);

const confirmedPlan = process.argv
  .find((value) => value.startsWith("--confirm-plan="))
  ?.split("=")[1];
const capArg = process.argv
  .find((value) => value.startsWith("--cap-eth="))
  ?.split("=")[1];
assert.equal(
  confirmedPlan,
  plan.planSha256,
  "EXACT_PLAN_CONFIRMATION_REQUIRED",
);
assert.equal(capArg, "0.00024", "UNAPPROVED_FEE_CAP");
const cap = parseEther(capArg);

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
assert.equal(
  relayer.address,
  getAddress(manifest.deployerAddress),
  "RELAYER_MISMATCH",
);
assert.equal(
  getAddress(plan.governance),
  getAddress(manifest.governanceAddress),
);

const tokenAbi = parseAbi([
  "function uid() view returns (bytes32)",
  "function uiMultiplier() view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);
const block = await client.getBlock();
for (const observation of plan.observations.filter(
  (item) => item.oracleFresh,
)) {
  const [uid, multiplier, round] = await Promise.all([
    client.readContract({
      address: getAddress(observation.address),
      abi: tokenAbi,
      functionName: "uid",
    }),
    client.readContract({
      address: getAddress(observation.address),
      abi: tokenAbi,
      functionName: "uiMultiplier",
    }),
    client.readContract({
      address: getAddress(observation.feed),
      abi: feedAbi,
      functionName: "latestRoundData",
    }),
  ]);
  assert.equal(
    uid.toLowerCase(),
    observation.issuerAssetId.toLowerCase(),
    `${observation.symbol}_UID_DRIFT`,
  );
  assert.equal(
    multiplier.toString(),
    observation.multiplierX18,
    `${observation.symbol}_MULTIPLIER_DRIFT`,
  );
  assert(
    round[0] > 0n && round[1] > 0n && round[4] >= round[0],
    `${observation.symbol}_INVALID_ORACLE`,
  );
  assert(block.timestamp >= round[3], `${observation.symbol}_FUTURE_ORACLE`);
  assert(
    block.timestamp - round[3] <= BigInt(observation.maximumAge),
    `${observation.symbol}_STALE_ORACLE`,
  );
}

type ReceiptRecord = Readonly<{
  name: string;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
}>;
let existing:
  | { planSha256: string; initialSafeNonce: string; receipts: ReceiptRecord[] }
  | undefined;
try {
  existing = JSON.parse(await readFile(executionPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (existing)
  assert.equal(existing.planSha256, plan.planSha256, "EXECUTION_PLAN_MISMATCH");
const receipts = [...(existing?.receipts ?? [])];
let spent = receipts.reduce(
  (total, item) => total + BigInt(item.totalFeeWei),
  0n,
);
assert(spent <= cap, "RECORDED_FEE_EXCEEDS_CAP");
const initialSafeNonce = existing
  ? BigInt(existing.initialSafeNonce)
  : await client.readContract({
      address: getAddress(plan.governance),
      abi: parseAbi(["function nonce() view returns (uint256)"]),
      functionName: "nonce",
    });
assert.equal(initialSafeNonce, 134n, "INITIAL_SAFE_NONCE_DRIFT");

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
        initialSafeNonce: initialSafeNonce.toString(),
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

const observedSafeNonce = await client.readContract({
  address: getAddress(plan.governance),
  abi: parseAbi(["function nonce() view returns (uint256)"]),
  functionName: "nonce",
});
const journalSafeNonce = initialSafeNonce + BigInt(receipts.length);
if (observedSafeNonce > journalSafeNonce) {
  assert.equal(
    observedSafeNonce,
    journalSafeNonce + 1n,
    "UNEXPECTED_SAFE_NONCE_ADVANCE",
  );
  const lastBlock = receipts.at(-1)?.blockNumber;
  assert(lastBlock, "RECOVERY_REQUIRES_PRIOR_RECEIPT");
  let recoveredHash: Hex | undefined;
  for (
    let number = BigInt(lastBlock) + 1n;
    number <= BigInt(lastBlock) + 100n;
    number += 1n
  ) {
    const candidate = await client.getBlock({
      blockNumber: number,
      includeTransactions: true,
    });
    const transaction = candidate.transactions.find(
      (item) =>
        typeof item !== "string" &&
        item.from.toLowerCase() === relayer.address.toLowerCase() &&
        item.to?.toLowerCase() === plan.governance.toLowerCase(),
    );
    if (transaction && typeof transaction !== "string") {
      recoveredHash = transaction.hash;
      break;
    }
  }
  assert(recoveredHash, "ADVANCED_SAFE_TRANSACTION_NOT_FOUND");
  await record(
    plan.actions[receipts.length]!.name,
    await client.waitForTransactionReceipt({
      hash: recoveredHash,
      confirmations: 1,
    }),
  );
}

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
  const [estimatedGas, gasPrice] = await Promise.all([
    client.estimateGas({
      account: relayer,
      to: operation.to,
      data: operation.data,
    }),
    client.getGasPrice(),
  ]);
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
await persist("confirmed");
console.log(
  JSON.stringify({
    planSha256: plan.planSha256,
    status: "confirmed",
    transactions: receipts.map(({ transactionHash }) => transactionHash),
    transactionCount: receipts.length,
    totalFeeEth: formatEther(spent),
    capEth: formatEther(cap),
    enabledAssets: ["AMD", "AMZN", "META", "PLTR", "TSLA"],
    blockedAssets: ["NFLX"],
    graduationEnabled: false,
  }),
);
