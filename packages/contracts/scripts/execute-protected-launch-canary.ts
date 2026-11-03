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
import { prepareSafeOperation } from "./safe-operation.js";

const APPROVED_PLAN = "28d5d732c08854f2d7fe083d6a1f8bef48295b84e4473cdd43bda2602f9d206c";
const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(root, "deployments/mainnet/protected-launch/canary-plan.json");
const journalPath = path.join(root, "deployments/mainnet/protected-launch/canary-execution.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as any;
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
const planHashArg = process.argv.find((v) => v.startsWith("--plan="))?.slice(7);
const gasCapArg = process.argv.find((v) => v.startsWith("--cap-eth="))?.slice(10);
const usdgCapArg = process.argv.find((v) => v.startsWith("--cap-usdg="))?.slice(11);
assert.equal(planHashArg, APPROVED_PLAN, "Plan hash differs from owner approval");
assert.equal(gasCapArg, "0.0003", "Gas cap differs from owner approval");
assert.equal(usdgCapArg, "1.01", "USDG cap differs from owner approval");
assert.equal(process.env.APP_ENV, "mainnet");
const unsigned = { ...plan };
delete unsigned.planSha256;
assert.equal(createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"), APPROVED_PLAN);
assert.equal(plan.planSha256, APPROVED_PLAN);
assert.equal(plan.chainId, 4663);

const rpcCandidates = [
  process.env.RPC_BROADCAST_URL?.trim(),
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "").split(",").map((value) => value.trim()),
].filter((value): value is string => Boolean(value));
assert(rpcCandidates.length > 0, "RPC_URL_REQUIRED");
const selectRpc = async () => {
  for (const candidate of rpcCandidates) {
    try {
      const response = await fetch(candidate, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(8_000),
      });
      const payload = await response.json() as any;
      if (!response.ok || payload.result !== "0x1237") continue;
      const heightResponse = await fetch(candidate, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(8_000),
      });
      const height = (await heightResponse.json() as any).result;
      if (!height) continue;
      const fromBlock = `0x${(BigInt(height) - 100n).toString(16)}`;
      const logsResponse = await fetch(candidate, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_getLogs", params: [{ address: plan.addresses.factory, fromBlock, toBlock: height }] }),
        signal: AbortSignal.timeout(8_000),
      });
      const logs = await logsResponse.json() as any;
      if (logsResponse.ok && Array.isArray(logs.result)) return candidate;
    } catch { /* try the next configured endpoint */ }
  }
  throw new Error("NO_HEALTHY_ROBINHOOD_MAINNET_RPC");
};
const rpc = await selectRpc();
const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(key && /^0x[\da-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY_INVALID");
const account = privateKeyToAccount(key as Hex);
assert.equal(account.address, getAddress(plan.owner));
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = http(rpc, { timeout: 30_000, retryCount: 2 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
assert.equal(await client.getChainId(), 4663);

const artifact = async (name: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${name}.sol/${name}.json`), "utf8")) as any).abi;
const [policyAbi, factoryAbi, poolAbi, routerAbi, erc20Abi, managerAbi, escrowAbi] = await Promise.all([
  artifact("LaunchProtectionPolicyRegistry"), artifact("ProtectedLaunchFactory"),
  artifact("ProtectedVirtualPool"), artifact("ProtectedLaunchRouter"), artifact("MockERC20"),
  artifact("ProtectedGraduationManager"), artifact("ProtectedLPAllocationEscrow"),
]);
const addresses = {
  safe: getAddress(plan.governance) as Address,
  policy: getAddress(plan.addresses.policyRegistry) as Address,
  factory: getAddress(plan.addresses.factory) as Address,
  router: getAddress(plan.addresses.router) as Address,
  usdg: getAddress(plan.addresses.usdg) as Address,
  manager: getAddress(manifest.protectedLaunch.graduationManager) as Address,
  adapter: getAddress(manifest.protectedLaunch.dammGraduationAdapter) as Address,
  escrow: getAddress(manifest.protectedLaunch.lpEscrow) as Address,
};

type Entry = { stage: string; hash: Hex; blockNumber: string; gasUsed: string; feeWei: string };
type Journal = { status: string; transactions: Entry[]; grossUsdgAuthorizedRaw: string; launchId?: Hex; token?: Address; pool?: Address; migrationId?: Hex; destinationPool?: Address; creatorUnlockAt?: string; checks: Record<string, unknown> };
let journal: Journal;
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch { journal = { status: "started", transactions: [], grossUsdgAuthorizedRaw: "0", checks: {} }; }
const gasCap = parseEther("0.0003");
const usdgCap = 1_010_000n;
const spent = () => journal.transactions.reduce((n, tx) => n + BigInt(tx.feeWei), 0n);
const done = (stage: string) => journal.transactions.some((tx) => tx.stage === stage);
const save = async () => writeFile(journalPath, `${JSON.stringify({ ...journal, planSha256: APPROVED_PLAN, approvedGasCapEth: "0.0003", approvedUsdgCap: "1.01", totalFeeWei: spent().toString(), totalFeeEth: formatEther(spent()) }, null, 2)}\n`);
const record = async (stage: string, hash: Hex) => {
  const receipt: TransactionReceipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  assert.equal(receipt.status, "success", `${stage} reverted`);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  journal.transactions.push({ stage, hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), feeWei: fee.toString() });
  assert(spent() <= gasCap, `Gas cap exceeded after ${stage}`);
  await save();
  console.log(JSON.stringify({ stage, hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), totalFeeEth: formatEther(spent()) }));
};
const send = async (stage: string, request: any) => {
  if (done(stage)) return;
  const raw = request.data && !request.abi;
  const gas = raw
    ? await client.estimateGas({ account, to: request.address, data: request.data })
    : await client.estimateContractGas(request);
  const price = await client.getGasPrice();
  assert(spent() + gas * price * 3n / 2n <= gasCap, `Gas guard stopped before ${stage}`);
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = raw
    ? await wallet.sendTransaction({ account, to: request.address, data: request.data, gas: gas * 6n / 5n, nonce })
    : await wallet.writeContract({ ...request, gas: gas * 6n / 5n, nonce });
  await record(stage, hash);
};
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1800);

if (!done("create-policy")) {
  assert.equal(await client.readContract({ address: addresses.policy, abi: policyAbi, functionName: "policyCount" }), BigInt(plan.currentPolicyCount));
  const safe = await prepareSafeOperation(client, { chainId: 4663, safe: addresses.safe, to: addresses.policy, data: plan.calldata.createPolicy, relayer: account });
  await send("create-policy", { account, address: safe.to, data: safe.data });
}
assert((await client.readContract({ address: addresses.policy, abi: policyAbi, functionName: "policyCount" }) as bigint) >= BigInt(plan.predictedPolicyId));

const launchId = await client.readContract({ address: addresses.factory, abi: factoryAbi, functionName: "launchIdentifier", args: [account.address, 1n, BigInt(plan.predictedPolicyId), plan.launch.salt] }) as Hex;
let launch = await client.readContract({ address: addresses.factory, abi: factoryAbi, functionName: "launches", args: [launchId] }) as any;
if (!done("create-launch") && launch[0] !== account.address) {
  await send("create-launch", { account, address: addresses.factory, abi: factoryAbi, functionName: "createLaunch", args: [{ templateId: 1n, policyId: BigInt(plan.predictedPolicyId), salt: plan.launch.salt, deadline: BigInt(plan.launch.deadline), name: plan.launch.name, symbol: plan.launch.symbol, metadataURI: plan.launch.metadataURI, creatorTokenRecipient: account.address }] });
  launch = await client.readContract({ address: addresses.factory, abi: factoryAbi, functionName: "launches", args: [launchId] }) as any;
} else if (!done("create-launch")) {
  const policyReceiptBlock = BigInt(journal.transactions.find((tx) => tx.stage === "create-policy")!.blockNumber);
  let recovered: Hex | undefined;
  for (let blockNumber = policyReceiptBlock; blockNumber < policyReceiptBlock + 200n && !recovered; blockNumber++) {
    const block = await client.getBlock({ blockNumber, includeTransactions: true });
    const tx = block.transactions.find((item: any) =>
      typeof item !== "string" && item.from.toLowerCase() === account.address.toLowerCase()
      && item.to?.toLowerCase() === addresses.factory.toLowerCase()
    ) as any;
    recovered = tx?.hash;
  }
  assert(recovered, "CREATE_LAUNCH_RECEIPT_NOT_FOUND");
  await record("create-launch", recovered);
}
journal.launchId = launchId; journal.token = getAddress(launch[1]); journal.pool = getAddress(launch[2]); await save();

assert(journal.pool && journal.token);
if (!journal.checks.capRejection) {
  let rejected = false;
  try {
    const q = await client.readContract({ address: journal.pool, abi: poolAbi, functionName: "quoteBuyExactInput", args: [100_000n] }) as any;
    await client.simulateContract({ account, address: addresses.router, abi: routerAbi, functionName: "buyExactInput", args: [journal.pool, q.grossQuoteConsumedRaw, 0n, q.finalPriceX18 * 2n, account.address, deadline()] });
  } catch { rejected = true; }
  assert(rejected, "Protected cap simulation unexpectedly succeeded");
  journal.checks.capRejection = true; await save();
}

await send("approve-usdg", { account, address: addresses.usdg, abi: erc20Abi, functionName: "approve", args: [addresses.router, usdgCap] });
if (!done("protected-buy")) {
  const q = await client.readContract({ address: journal.pool, abi: poolAbi, functionName: "quoteBuyExactInput", args: [1_000n] }) as any;
  journal.grossUsdgAuthorizedRaw = q.grossQuoteConsumedRaw.toString();
  assert(BigInt(journal.grossUsdgAuthorizedRaw) <= usdgCap);
  await send("protected-buy", { account, address: addresses.router, abi: routerAbi, functionName: "buyExactInput", args: [journal.pool, q.grossQuoteConsumedRaw, q.baseOutRaw * 99n / 100n, q.finalPriceX18 * 101n / 100n, account.address, deadline()] });
}
await send("approve-zkpc", { account, address: journal.token, abi: erc20Abi, functionName: "approve", args: [addresses.router, 2n ** 256n - 1n] });
if (!done("protected-sell")) {
  const balance = await client.readContract({ address: journal.token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const sellAmount = balance / 1000n;
  assert(sellAmount > 0n);
  const q = await client.readContract({ address: journal.pool, abi: poolAbi, functionName: "quoteSellExactInput", args: [sellAmount] }) as any;
  await send("protected-sell", { account, address: addresses.router, abi: routerAbi, functionName: "sellExactInput", args: [journal.pool, sellAmount, q.netQuoteOutRaw * 99n / 100n, q.finalPriceX18 * 99n / 100n, account.address, deadline()] });
}

while ((await client.getBlockNumber()) < BigInt(launch[6]) + BigInt(plan.policy.protectionBlocks)) await new Promise((resolve) => setTimeout(resolve, 3000));
if (!done("reach-threshold")) {
  const used = BigInt(journal.grossUsdgAuthorizedRaw);
  const available = usdgCap - used;
  const q = await client.readContract({ address: journal.pool, abi: poolAbi, functionName: "quoteBuyExactInput", args: [available] }) as any;
  assert(used + q.grossQuoteConsumedRaw <= usdgCap);
  journal.grossUsdgAuthorizedRaw = (used + q.grossQuoteConsumedRaw).toString(); await save();
  await send("reach-threshold", { account, address: addresses.router, abi: routerAbi, functionName: "buyExactInput", args: [journal.pool, q.grossQuoteConsumedRaw, q.baseOutRaw * 99n / 100n, q.finalPriceX18 * 101n / 100n, account.address, deadline()] });
}
assert.equal(await client.readContract({ address: journal.pool, abi: poolAbi, functionName: "lifecycle" }), 3);
await send("graduate-damm", { account, address: addresses.manager, abi: managerAbi, functionName: "graduate", args: [journal.pool, addresses.adapter, deadline()] });
const migrationId = await client.readContract({ address: addresses.manager, abi: managerAbi, functionName: "migrationByLaunch", args: [launchId] }) as Hex;
journal.migrationId = migrationId;
const allocation = await client.readContract({ address: addresses.escrow, abi: escrowAbi, functionName: "allocations", args: [migrationId] }) as any;
journal.destinationPool = getAddress(allocation[0]); journal.creatorUnlockAt = allocation[7].toString();
if (!journal.checks.preUnlockRejected && BigInt(Math.floor(Date.now() / 1000)) < allocation[7]) {
  let rejected = false;
  try { await client.simulateContract({ account, address: addresses.escrow, abi: escrowAbi, functionName: "claim", args: [migrationId, true, 0n, 0n, deadline()] }); } catch { rejected = true; }
  assert(rejected); journal.checks.preUnlockRejected = true; await save();
}
while (BigInt(Math.floor(Date.now() / 1000)) <= allocation[7]) await new Promise((resolve) => setTimeout(resolve, 10_000));
await send("claim-creator-lp", { account, address: addresses.escrow, abi: escrowAbi, functionName: "claim", args: [migrationId, true, 0n, 0n, deadline()] });
journal.status = "complete"; journal.checks.accountingReconciles = await client.readContract({ address: addresses.manager, abi: managerAbi, functionName: "accountingReconciles", args: [migrationId] }); await save();
console.log(JSON.stringify({ status: journal.status, launchId, token: journal.token, protectedPool: journal.pool, destinationPool: journal.destinationPool, migrationId, totalFeeEth: formatEther(spent()), grossUsdgAuthorizedRaw: journal.grossUsdgAuthorizedRaw }, null, 2));
