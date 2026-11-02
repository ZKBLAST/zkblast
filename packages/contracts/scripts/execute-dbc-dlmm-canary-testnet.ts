import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  defineChain,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { save } from "./permissionless-upgrade-support.js";

type Plan = {
  chainId: number;
  deployer: Address;
  governance: Address;
  startingNonce: number;
  quoteToken: Address;
  templateId: string;
  salt: Hex;
  contracts: {
    configRegistry: Address;
    launchFactory: Address;
    graduationManager: Address;
    dlmmGraduationAdapter: Address;
    lpAllocationEscrow: Address;
  };
  staticActions: Array<{ name: string; to: Address | null; data?: Hex; dataHash: Hex }>;
  gasCeilings: Record<string, string>;
  gasPriceWei: string;
  feeCeilingWei: string;
};
type Journal = {
  transactions: Array<{ stage: string; hash: Hex; blockNumber: string; gasUsed: string; feeWei: string; status: string; contractAddress?: Address }>;
  launchId?: Hex;
  token?: Address;
  virtualPool?: Address;
  migrationId?: Hex;
  destinationPool?: Address;
  verification?: {
    lifecycle: number;
    accountingReconciles: boolean;
    migrationCompleted: boolean;
    dlmmAllocation: boolean;
    activeBin: string;
    binStepBps: number;
    administrator: Address;
    protocolFeeRecipient: Address;
    adapterQuoteDustRaw: string;
    adapterBaseDustRaw: string;
  };
  totalFeeWei?: string;
  totalFeeEth?: string;
  capEth?: string;
  complete: boolean;
};

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(await readFile(path.join(root, "deployments/testnet/dbc-dlmm-canary-plan.json"), "utf8")) as Plan;
const journalFile = path.join(root, "deployments/testnet/dbc-dlmm-canary-execution.json");
const capArg = process.argv.find((item) => item.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArg, "0.00015", "Canary cap differs from owner approval");
const cap = parseEther(capArg);
assert(BigInt(plan.feeCeilingWei) <= cap, "Canary plan exceeds cap");
assert.equal(plan.chainId, 46630);
assert(process.env.RPC_URL, "RPC_URL missing");
const keyAccount = (name: string, expected: Address) => {
  const value = process.env[name]?.trim();
  assert(value && /^0x[\da-f]{64}$/iu.test(value), `${name} invalid`);
  const account = privateKeyToAccount(value as Hex);
  assert.equal(account.address, getAddress(expected), `${name} mismatch`);
  return account;
};
const deployer = keyAccount("DEPLOYER_PRIVATE_KEY", plan.deployer);
const governance = keyAccount("GOVERNANCE_PRIVATE_KEY", plan.governance);
const chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const client = createPublicClient({ chain, transport });
const deployerWallet = createWalletClient({ account: deployer, chain, transport });
const governanceWallet = createWalletClient({ account: governance, chain, transport });
assert.equal(await client.getChainId(), 46630);
const gasPrice = await client.getGasPrice();
assert(gasPrice <= BigInt(plan.gasPriceWei), "Gas price increased; refresh plan");

let journal: Journal;
try {
  journal = JSON.parse(await readFile(journalFile, "utf8")) as Journal;
} catch {
  journal = { transactions: [], complete: false };
}
const done = (stage: string) => journal.transactions.some((item) => item.stage === stage && item.status === "success");
const spent = () => journal.transactions.reduce((sum, item) => sum + BigInt(item.feeWei), 0n);
const record = async (stage: string, receipt: TransactionReceipt) => {
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  journal.transactions.push({
    stage,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    feeWei: fee.toString(),
    status: receipt.status,
    ...(receipt.contractAddress ? { contractAddress: getAddress(receipt.contractAddress) } : {}),
  });
  await save(journalFile, journal);
  assert(spent() <= cap, "Canary cap exceeded");
  assert.equal(receipt.status, "success", `${stage} reverted`);
};
const gas = (stage: string) => BigInt(plan.gasCeilings[stage]!);

const tokenArtifact = JSON.parse(
  await readFile(path.join(root, "packages/contracts/out/ZkblastTestnetToken.sol/ZkblastTestnetToken.json"), "utf8"),
) as { abi: Abi; bytecode: { object: Hex } };
const tokenCreationData = encodeDeployData({
  abi: tokenArtifact.abi,
  bytecode: tokenArtifact.bytecode.object,
  args: ["ZKBLAST DLMM Canary Quote", "ZKDCQ", deployer.address, 10n * 10n ** 18n],
});
assert.equal(keccak256(tokenCreationData), plan.staticActions.find((item) => item.name === "deployQuoteToken")!.dataHash);
if (!done("deployQuoteToken")) {
  assert.equal(await client.getTransactionCount({ address: deployer.address, blockTag: "pending" }), plan.startingNonce);
  const predictedCode = await client.getCode({ address: plan.quoteToken });
  assert(!predictedCode || predictedCode === "0x", "Quote token predicted address occupied");
  const hash = await deployerWallet.sendTransaction({ account: deployer, data: tokenCreationData, gas: gas("deployQuoteToken"), gasPrice });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(getAddress(receipt.contractAddress!), getAddress(plan.quoteToken));
  await record("deployQuoteToken", receipt);
}

const sendStatic = async (stage: string, wallet: typeof governanceWallet | typeof deployerWallet, account: typeof governance | typeof deployer) => {
  if (done(stage)) return;
  const action = plan.staticActions.find((item) => item.name === stage)!;
  assert(action.to && action.data && keccak256(action.data) === action.dataHash);
  const hash = await wallet.sendTransaction({ account, to: action.to, data: action.data, gas: gas(stage), gasPrice });
  await record(stage, await client.waitForTransactionReceipt({ hash }));
};
await sendStatic("allowQuoteToken", governanceWallet, governance);
await sendStatic("createTemplate", governanceWallet, governance);
await sendStatic("createLaunch", deployerWallet, deployer);

const launchAbi = parseAbi([
  "function launchIdentifier(address,uint256,bytes32) view returns (bytes32)",
  "function launches(bytes32) view returns (address creator,address token,address virtualPool,uint256 templateId)",
]);
const launchId = await client.readContract({
  address: plan.contracts.launchFactory,
  abi: launchAbi,
  functionName: "launchIdentifier",
  args: [deployer.address, BigInt(plan.templateId), plan.salt],
});
const launch = await client.readContract({ address: plan.contracts.launchFactory, abi: launchAbi, functionName: "launches", args: [launchId] });
journal.launchId = launchId;
journal.token = getAddress(launch[1]);
journal.virtualPool = getAddress(launch[2]);
assert.equal(launch[0], deployer.address);
assert.equal(launch[3], BigInt(plan.templateId));
await save(journalFile, journal);

const erc20Abi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
if (!done("approveQuote")) {
  const hash = await deployerWallet.writeContract({
    account: deployer,
    address: plan.quoteToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [journal.virtualPool, 2n * 10n ** 15n],
    gas: gas("approveQuote"),
    gasPrice,
  });
  await record("approveQuote", await client.waitForTransactionReceipt({ hash }));
}
const poolAbi = parseAbi([
  "function quoteBuyExactInput(uint256) view returns ((uint256 grossQuoteConsumedRaw,uint256 netQuoteRaw,uint256 baseOutRaw,uint256 feeRaw,uint256 finalPriceX18))",
  "function buyExactInput(uint256,uint256,uint256,address,uint256) returns ((uint256,uint256,uint256,uint256,uint256))",
  "function lifecycle() view returns (uint8)",
  "function graduationState() view returns ((bytes32 migrationId,address destinationPool,uint256 destinationShares,uint256 creatorSharesClaimed,uint256 protocolSharesClaimed,uint64 graduatedAt))",
]);
if (!done("buyToThreshold")) {
  const quote = await client.readContract({ address: journal.virtualPool!, abi: poolAbi, functionName: "quoteBuyExactInput", args: [2n * 10n ** 15n] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const hash = await deployerWallet.writeContract({
    account: deployer,
    address: journal.virtualPool!,
    abi: poolAbi,
    functionName: "buyExactInput",
    args: [quote.grossQuoteConsumedRaw, quote.baseOutRaw, quote.finalPriceX18, deployer.address, deadline],
    gas: gas("buyToThreshold"),
    gasPrice,
  });
  await record("buyToThreshold", await client.waitForTransactionReceipt({ hash }));
}
const lifecycle = await client.readContract({
  address: journal.virtualPool!,
  abi: poolAbi,
  functionName: "lifecycle",
});
assert.equal(lifecycle, done("graduate") ? 4 : 3);

const managerAbi = parseAbi([
  "function graduate(address,address,uint256) returns (address,uint256)",
  "function accountingReconciles(bytes32) view returns (bool)",
  "function migrationCompleted(bytes32) view returns (bool)",
]);
if (!done("graduate")) {
  const hash = await deployerWallet.writeContract({
    account: deployer,
    address: plan.contracts.graduationManager,
    abi: managerAbi,
    functionName: "graduate",
    args: [journal.virtualPool!, plan.contracts.dlmmGraduationAdapter, BigInt(Math.floor(Date.now() / 1000) + 600)],
    gas: gas("graduate"),
    gasPrice,
  });
  await record("graduate", await client.waitForTransactionReceipt({ hash }));
}
const graduation = await client.readContract({ address: journal.virtualPool!, abi: poolAbi, functionName: "graduationState" });
journal.migrationId = graduation.migrationId;
journal.destinationPool = getAddress(graduation.destinationPool);
assert(graduation.destinationShares > 0n);
const migrationCompleted = await client.readContract({ address: plan.contracts.graduationManager, abi: managerAbi, functionName: "migrationCompleted", args: [graduation.migrationId] });
const accountingReconciles = await client.readContract({ address: plan.contracts.graduationManager, abi: managerAbi, functionName: "accountingReconciles", args: [graduation.migrationId] });
assert(migrationCompleted);
assert(accountingReconciles);

const escrowAbi = parseAbi([
  "function dlmmAllocation(bytes32) view returns (bool)",
  "function dlmmBinByMigration(bytes32) view returns (int24)",
  "function claim(bytes32,bool,uint256) returns (uint256,uint256)",
]);
const dlmmAllocation = await client.readContract({ address: plan.contracts.lpAllocationEscrow, abi: escrowAbi, functionName: "dlmmAllocation", args: [graduation.migrationId] });
assert(dlmmAllocation);
if (!done("claimProtocolLp")) {
  const hash = await governanceWallet.writeContract({
    account: governance,
    address: plan.contracts.lpAllocationEscrow,
    abi: escrowAbi,
    functionName: "claim",
    args: [graduation.migrationId, false, BigInt(Math.floor(Date.now() / 1000) + 600)],
    gas: gas("claimProtocolLp"),
    gasPrice,
  });
  await record("claimProtocolLp", await client.waitForTransactionReceipt({ hash }));
}

const dlmmAbi = parseAbi([
  "function activeBin() view returns (int24)",
  "function administrator() view returns (address)",
  "function protocolFeeRecipient() view returns (address)",
  "function binStepBps() view returns (uint16)",
]);
const binId = await client.readContract({ address: plan.contracts.lpAllocationEscrow, abi: escrowAbi, functionName: "dlmmBinByMigration", args: [graduation.migrationId] });
assert.equal(await client.readContract({ address: journal.destinationPool!, abi: dlmmAbi, functionName: "activeBin" }), binId);
assert.equal(getAddress(await client.readContract({ address: journal.destinationPool!, abi: dlmmAbi, functionName: "administrator" })), governance.address);
assert.equal(getAddress(await client.readContract({ address: journal.destinationPool!, abi: dlmmAbi, functionName: "protocolFeeRecipient" })), governance.address);
assert.equal(await client.readContract({ address: journal.destinationPool!, abi: dlmmAbi, functionName: "binStepBps" }), 25);
assert.equal(await client.readContract({ address: plan.quoteToken, abi: erc20Abi, functionName: "balanceOf", args: [plan.contracts.dlmmGraduationAdapter] }), 0n);
assert.equal(await client.readContract({ address: journal.token!, abi: erc20Abi, functionName: "balanceOf", args: [plan.contracts.dlmmGraduationAdapter] }), 0n);

journal.verification = {
  lifecycle: Number(lifecycle),
  accountingReconciles,
  migrationCompleted,
  dlmmAllocation,
  activeBin: binId.toString(),
  binStepBps: 25,
  administrator: governance.address,
  protocolFeeRecipient: governance.address,
  adapterQuoteDustRaw: "0",
  adapterBaseDustRaw: "0",
};
journal.totalFeeWei = spent().toString();
journal.totalFeeEth = formatEther(spent());
journal.capEth = formatEther(cap);
journal.complete = true;
await save(journalFile, journal);
console.log(JSON.stringify({
  status: "complete",
  transactions: journal.transactions.length,
  totalFeeWei: spent().toString(),
  totalFeeEth: formatEther(spent()),
  capEth: formatEther(cap),
  quoteToken: plan.quoteToken,
  launchId: journal.launchId,
  launchToken: journal.token,
  virtualPool: journal.virtualPool,
  migrationId: journal.migrationId,
  dlmmPool: journal.destinationPool,
  activeBin: binId,
}, null, 2));
