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
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
const isFork = process.env.CANARY_FORK === "1";
const capEthArg = process.argv
  .find((value) => value.startsWith("--cap-eth="))
  ?.split("=")[1];
const capUsdgArg = process.argv
  .find((value) => value.startsWith("--cap-usdg="))
  ?.split("=")[1];
assert.equal(capEthArg, "0.00035", "Gas cap differs from owner approval");
assert.equal(capUsdgArg, "1.01", "USDG cap differs from owner approval");
assert.equal(process.env.APP_ENV, "mainnet");
assert(process.env.RPC_URL);
const gasCap = parseEther(capEthArg);
const usdgCapRaw = 1_010_000n;
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(
  key && /^0x[0-9a-f]{64}$/iu.test(key),
  "DEPLOYER_PRIVATE_KEY is invalid",
);
const account = privateKeyToAccount(key as Hex);
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as any;
assert.equal(account.address, getAddress(manifest.deployerAddress));
const plan = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/launchpad-canary-v1-plan.json"),
    "utf8",
  ),
) as any;
const evidencePath = path.join(
  root,
  `deployments/mainnet/launchpad-canary-v1-${isFork ? "full-simulation" : "execution"}.json`,
);
const artifact = async (name: string): Promise<Abi> =>
  (
    JSON.parse(
      await readFile(
        path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    ) as { abi: Abi }
  ).abi;
const [
  factoryAbi,
  feeAbi,
  tokenFactoryAbi,
  registryAbi,
  poolAbi,
  erc20Abi,
  collectorAbi,
  splitterAbi,
  managerAbi,
  escrowAbi,
] = await Promise.all([
  artifact("LaunchpadFactory"),
  artifact("LaunchpadFeeController"),
  artifact("LaunchpadTokenFactory"),
  artifact("LaunchpadRegistry"),
  artifact("VirtualPool"),
  artifact("LaunchToken"),
  artifact("LaunchpadFeeCollector"),
  artifact("RevenueSplitter"),
  artifact("GraduationManager"),
  artifact("LPAllocationEscrow"),
]);
const rpc = process.env.RPC_URL;
const chain = defineChain({
  id: 4663,
  name: isFork ? "Robinhood Chain fork" : "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc, { timeout: 30_000, retryCount: 1 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
assert.equal(await client.getChainId(), 4663);

type Tx = {
  stage: string;
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
  feeWei: string;
};
type Journal = {
  transactions: Tx[];
  status: string;
  launchpadId?: string;
  launchId?: Hex;
  token?: Address;
  pool?: Address;
  feeSnapshotId?: Hex;
  grossUsdgSpentRaw: string;
  migrationId?: Hex;
  destinationPool?: Address;
  creatorLpUnlockAt?: string;
};
let journal: Journal;
try {
  journal = JSON.parse(await readFile(evidencePath, "utf8"));
} catch {
  journal = { transactions: [], status: "started", grossUsdgSpentRaw: "0" };
}
const done = (stage: string) =>
  journal.transactions.some((item) => item.stage === stage);
const spent = () =>
  journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const save = async () =>
  writeFile(
    evidencePath,
    `${JSON.stringify({ ...journal, environment: isFork ? "mainnet-fork" : "mainnet", chainId: 4663, approvedGasCapEth: capEthArg, approvedUsdgCap: capUsdgArg, totalFeeWei: spent().toString(), totalFeeEth: formatEther(spent()) }, null, 2)}\n`,
  );
const record = async (stage: string, hash: Hex) => {
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert.equal(receipt.status, "success", `${stage} reverted`);
  const accountingGasPrice = isFork
    ? BigInt(plan.liveEstimate.gasPriceWei)
    : receipt.effectiveGasPrice;
  const fee = receipt.gasUsed * accountingGasPrice;
  journal.transactions.push({
    stage,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    feeWei: fee.toString(),
  });
  assert(spent() <= gasCap, `Gas cap exceeded after ${stage}`);
  await save();
};
const send = async (stage: string, request: any) => {
  if (done(stage)) return;
  const estimate = await client.estimateContractGas(request);
  const price = isFork
    ? BigInt(plan.liveEstimate.gasPriceWei)
    : await client.getGasPrice();
  assert(
    spent() + estimate * price * 2n <= gasCap,
    `Gas guard stopped before ${stage}`,
  );
  await record(stage, await wallet.writeContract(request));
};
const deadline = () => BigInt(Math.floor(Date.now() / 1_000) + 1_800);
const addresses = {
  registry: getAddress(manifest.launchpad.registry),
  factory: getAddress(manifest.launchpad.factory),
  feeController: getAddress(manifest.launchpad.feeController),
  tokenFactory: getAddress(manifest.launchpad.tokenFactory),
  feeCollector: getAddress(manifest.launchpad.feeCollector),
  revenueSplitter: getAddress(manifest.launchpad.revenueSplitter),
  graduationManager: getAddress(manifest.dbc.graduationManager),
  dammAdapter: getAddress(manifest.dbc.dammGraduationAdapter),
  lpEscrow: getAddress(manifest.dbc.lpAllocationEscrow),
  usdg: getAddress(plan.addresses.usdg),
};

if (!done("create-launchpad")) {
  const count = (await client.readContract({
    address: addresses.registry,
    abi: registryAbi,
    functionName: "launchpadCount",
  })) as bigint;
  assert.equal(count, 0n, "Canary expects the first launchpad");
  await send("create-launchpad", {
    account,
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "createLaunchpad",
    args: [
      account.address,
      account.address,
      plan.metadataHash,
      plan.slugCommitment,
      1n,
    ],
  });
  journal.launchpadId = "1";
  await save();
}
assert(journal.launchpadId);
await send("configure-fee-policy", {
  account,
  address: addresses.feeController,
  abi: feeAbi,
  functionName: "setLaunchpadFeePolicy",
  args: [
    BigInt(journal.launchpadId),
    30,
    {
      protocolShareBps: 2_000,
      operatorShareBps: 3_000,
      creatorShareBps: 5_000,
      referralShareBps: 0,
    },
    account.address,
  ],
});

if (!done("create-bound-token")) {
  const request = {
    launchpadId: BigInt(journal.launchpadId),
    dbc: {
      templateId: 1n,
      salt:
        plan.tokenSalt ??
        "0x4bbd6c4d53fe4167f14e994280a8ea67fab8b958bb658aee54d3673aac20d9b9",
      name: "ZKBLAST Launchpad Canary",
      symbol: "ZLPC",
      metadataURI: "zkblast://mainnet-canary-v1",
      creatorTokenRecipient: account.address,
    },
    referralRecipient: "0x0000000000000000000000000000000000000000",
  };
  const simulation = await client.simulateContract({
    account,
    address: addresses.tokenFactory,
    abi: tokenFactoryAbi,
    functionName: "createLaunch",
    args: [request],
  });
  const [launchId, token, pool, feeSnapshotId] = simulation.result as readonly [
    Hex,
    Address,
    Address,
    Hex,
  ];
  await send("create-bound-token", simulation.request);
  Object.assign(journal, {
    launchId,
    token: getAddress(token),
    pool: getAddress(pool),
    feeSnapshotId,
  });
  await save();
}
assert(journal.pool && journal.token && journal.feeSnapshotId);
await send("approve-usdg", {
  account,
  address: addresses.usdg,
  abi: erc20Abi,
  functionName: "approve",
  args: [journal.pool, usdgCapRaw],
});

if (!done("buy-probe")) {
  const quote = (await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "quoteBuyExactInput",
    args: [10_000n],
  })) as any;
  assert(
    BigInt(journal.grossUsdgSpentRaw) + quote.grossQuoteConsumedRaw <=
      usdgCapRaw,
  );
  await send("buy-probe", {
    account,
    address: journal.pool,
    abi: poolAbi,
    functionName: "buyExactInput",
    args: [
      quote.grossQuoteConsumedRaw,
      (quote.baseOutRaw * 99n) / 100n,
      (quote.finalPriceX18 * 101n) / 100n,
      account.address,
      deadline(),
    ],
  });
  journal.grossUsdgSpentRaw = (
    BigInt(journal.grossUsdgSpentRaw) + quote.grossQuoteConsumedRaw
  ).toString();
  await save();
}
if (!done("sell-probe")) {
  const accounting = (await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "accounting",
  })) as any;
  const sellAmount = BigInt(accounting.baseSoldRaw ?? accounting[0]) / 2n;
  assert(sellAmount > 0n, "Probe buy did not produce a sellable amount");
  await send("approve-token", {
    account,
    address: journal.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [journal.pool, sellAmount],
  });
  const quote = (await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "quoteSellExactInput",
    args: [sellAmount],
  })) as any;
  await send("sell-probe", {
    account,
    address: journal.pool,
    abi: poolAbi,
    functionName: "sellExactInput",
    args: [
      sellAmount,
      (quote.netQuoteOutRaw * 99n) / 100n,
      (quote.finalPriceX18 * 99n) / 100n,
      account.address,
      deadline(),
    ],
  });
}
if (!done("buy-to-threshold")) {
  const remainingBudget = usdgCapRaw - BigInt(journal.grossUsdgSpentRaw);
  const quote = (await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "quoteBuyExactInput",
    args: [remainingBudget],
  })) as any;
  assert(
    BigInt(journal.grossUsdgSpentRaw) + quote.grossQuoteConsumedRaw <=
      usdgCapRaw,
  );
  await send("buy-to-threshold", {
    account,
    address: journal.pool,
    abi: poolAbi,
    functionName: "buyExactInput",
    args: [
      quote.grossQuoteConsumedRaw,
      (quote.baseOutRaw * 99n) / 100n,
      (quote.finalPriceX18 * 101n) / 100n,
      account.address,
      deadline(),
    ],
  });
  journal.grossUsdgSpentRaw = (
    BigInt(journal.grossUsdgSpentRaw) + quote.grossQuoteConsumedRaw
  ).toString();
  await save();
}
assert.equal(
  await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "lifecycle",
  }),
  done("graduate-damm") ? 4 : 3,
);
await send("collect-trade-fees", {
  account,
  address: addresses.feeCollector,
  abi: collectorAbi,
  functionName: "collectTradeFees",
  args: [journal.pool],
});
await send("claim-revenue", {
  account,
  address: addresses.revenueSplitter,
  abi: splitterAbi,
  functionName: "claim",
  args: [journal.feeSnapshotId],
});
await send("graduate-damm", {
  account,
  address: addresses.graduationManager,
  abi: managerAbi,
  functionName: "graduate",
  args: [journal.pool, addresses.dammAdapter, deadline()],
});
const graduation = (await client.readContract({
  address: journal.pool,
  abi: poolAbi,
  functionName: "graduationState",
})) as any;
journal.migrationId = graduation.migrationId;
journal.destinationPool = getAddress(graduation.destinationPool);
await save();
const allocation = (await client.readContract({
  address: addresses.lpEscrow,
  abi: escrowAbi,
  functionName: "allocations",
  args: [journal.migrationId],
})) as any;
journal.creatorLpUnlockAt = String(allocation.creatorUnlockAt ?? allocation[5]);
assert.equal(
  await client.readContract({
    address: journal.pool,
    abi: poolAbi,
    functionName: "lifecycle",
  }),
  4,
);
assert.equal(
  await client.readContract({
    address: addresses.revenueSplitter,
    abi: splitterAbi,
    functionName: "claimableBySnapshot",
    args: [journal.feeSnapshotId, account.address],
  }),
  0n,
);
journal.status = "complete";
await save();
console.log(
  JSON.stringify({
    status: journal.status,
    environment: isFork ? "mainnet-fork" : "mainnet",
    launchpadId: journal.launchpadId,
    launchId: journal.launchId,
    token: journal.token,
    virtualPool: journal.pool,
    feeSnapshotId: journal.feeSnapshotId,
    migrationId: journal.migrationId,
    destinationPool: journal.destinationPool,
    grossUsdgSpentRaw: journal.grossUsdgSpentRaw,
    totalFeeEth: formatEther(spent()),
    evidencePath,
    evidenceSha256: createHash("sha256")
      .update(await readFile(evidencePath))
      .digest("hex"),
  }),
);
