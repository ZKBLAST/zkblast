import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  parseUnits,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex } }>;
type TransactionRecord = Readonly<{
  hash: Hash;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hash;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
}>;
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const output = path.resolve(directory, "../out");
const manifestPath = path.resolve(root, "deployments/testnet/market.json");
const journalPath = path.resolve(
  root,
  "deployments/testnet/market-deployment.private.json",
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function loadArtifact(
  source: string,
  contract: string,
): Promise<Artifact> {
  return JSON.parse(
    await readFile(
      path.join(output, `${source}.sol`, `${contract}.json`),
      "utf8",
    ),
  ) as Artifact;
}

assert(
  required("APP_ENV") === "testnet",
  "Testnet market deployment cannot run outside testnet",
);
const chainId = Number(required("CHAIN_ID"));
const rpcUrl = required("RPC_URL");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const privateKey = required("DEPLOYER_PRIVATE_KEY") as Hex;
assert(/^0x[\da-f]{64}$/iu.test(privateKey), "DEPLOYER_PRIVATE_KEY is invalid");
const governancePrivateKey = required("GOVERNANCE_PRIVATE_KEY") as Hex;
assert(
  /^0x[\da-f]{64}$/iu.test(governancePrivateKey),
  "GOVERNANCE_PRIVATE_KEY is invalid",
);
const protocol = JSON.parse(
  await readFile(
    path.resolve(root, required("DEPLOYMENT_MANIFEST_PATH")),
    "utf8",
  ),
) as {
  chainId: number;
  governanceAddress: Address;
  integration: {
    poolFactory: Address;
    poolQuoter: Address;
    swapRouter: Address;
  };
};
assert(protocol.chainId === chainId, "Protocol manifest chain mismatch");
const account = privateKeyToAccount(privateKey);
const governanceAccount = privateKeyToAccount(governancePrivateKey);
assert(
  getAddress(protocol.governanceAddress) === governanceAccount.address,
  "GOVERNANCE_PRIVATE_KEY must match the testnet factory admin",
);
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});
const governanceWallet = createWalletClient({
  account: governanceAccount,
  chain,
  transport: http(rpcUrl),
});
assert((await publicClient.getChainId()) === chainId, "RPC chain mismatch");
const tokenArtifact = await loadArtifact(
  "ZkblastTestnetToken",
  "ZkblastTestnetToken",
);
const factoryArtifact = await loadArtifact("PoolFactory", "PoolFactory");
const poolArtifact = await loadArtifact("DammPool", "DammPool");
const quoterArtifact = await loadArtifact("PoolQuoter", "PoolQuoter");
const routerArtifact = await loadArtifact("SwapRouter", "SwapRouter");
const transactions: Record<string, TransactionRecord> = {};

function record(receipt: TransactionReceipt): TransactionRecord {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress
      ? getAddress(receipt.contractAddress)
      : null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  };
}
async function wait(label: string, hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert(receipt.status === "success", `${label} reverted`);
  transactions[label] = record(receipt);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(
    journalPath,
    `${JSON.stringify({ protocol: "ZKBLAST", environment: "testnet", chainId, updatedAt: new Date().toISOString(), transactions }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return receipt;
}
async function deployToken(name: string, symbol: string) {
  const hash = await walletClient.deployContract({
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object,
    args: [name, symbol, account.address, parseUnits("1000000", 18)],
    account,
  });
  const receipt = await wait(`deploy${symbol}`, hash);
  assert(receipt.contractAddress, `${symbol} address missing`);
  return getAddress(receipt.contractAddress);
}
async function write(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  label: string,
) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  return wait(label, await walletClient.writeContract(request));
}
async function governanceWrite(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  label: string,
) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: governanceAccount,
  });
  return wait(label, await governanceWallet.writeContract(request));
}

const tokenA = await deployToken("ZKBLAST Testnet Alpha", "ZKTA");
const tokenB = await deployToken("ZKBLAST Testnet Beta", "ZKTB");
const createReceipt = await governanceWrite(
  protocol.integration.poolFactory,
  factoryArtifact.abi,
  "createPool",
  [tokenA, tokenB, 0, 3_000, 0],
  "createPool",
);
let pool: Address | undefined;
for (const log of createReceipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: factoryArtifact.abi,
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName === "PoolCreated")
      pool = getAddress((decoded.args as unknown as { pool: Address }).pool);
  } catch {
    /* unrelated log */
  }
}
assert(pool, "PoolCreated event missing");
const token0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
const token1 = token0 === tokenA ? tokenB : tokenA;
const liquidityAmount = parseUnits("100000", 18);
await write(
  token0,
  tokenArtifact.abi,
  "approve",
  [pool, liquidityAmount],
  "approveLiquidityToken0",
);
await write(
  token1,
  tokenArtifact.abi,
  "approve",
  [pool, liquidityAmount],
  "approveLiquidityToken1",
);
await write(
  pool,
  poolArtifact.abi,
  "addLiquidity",
  [
    liquidityAmount,
    liquidityAmount,
    1n,
    account.address,
    BigInt(Math.floor(Date.now() / 1000) + 1_200),
  ],
  "addLiquidity",
);
const swapAmount = parseUnits("100", 18);
await write(
  token0,
  tokenArtifact.abi,
  "approve",
  [protocol.integration.swapRouter, swapAmount],
  "approveSwap",
);
const [quotedAmountOut] = (await publicClient.readContract({
  address: protocol.integration.poolQuoter,
  abi: quoterArtifact.abi,
  functionName: "quoteDammExactInput",
  args: [pool, token0, swapAmount],
})) as readonly [bigint, bigint];
const minimumAmountOut = (quotedAmountOut * 99n) / 100n;
const swapReceipt = await write(
  protocol.integration.swapRouter,
  routerArtifact.abi,
  "swapDammExactInput",
  [
    pool,
    token0,
    swapAmount,
    minimumAmountOut,
    account.address,
    BigInt(Math.floor(Date.now() / 1000) + 1_200),
  ],
  "swapE2E",
);
const values = Object.values(transactions);
const manifest = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  generatedAt: new Date().toISOString(),
  deployerAddress: account.address,
  explorerUrl,
  tokens: [
    {
      address: token0,
      name:
        token0 === tokenA ? "ZKBLAST Testnet Alpha" : "ZKBLAST Testnet Beta",
      symbol: token0 === tokenA ? "ZKTA" : "ZKTB",
      decimals: 18,
    },
    {
      address: token1,
      name:
        token1 === tokenA ? "ZKBLAST Testnet Alpha" : "ZKBLAST Testnet Beta",
      symbol: token1 === tokenA ? "ZKTA" : "ZKTB",
      decimals: 18,
    },
  ],
  pool: {
    address: pool,
    model: "damm",
    feePips: 3_000,
    feeBps: 30,
    initialLiquidity0: liquidityAmount.toString(),
    initialLiquidity1: liquidityAmount.toString(),
    createdBlock: Number(createReceipt.blockNumber),
  },
  acceptanceSwap: {
    tokenIn: token0,
    amountIn: swapAmount.toString(),
    quotedAmountOut: quotedAmountOut.toString(),
    minimumAmountOut: minimumAmountOut.toString(),
    transactionHash: swapReceipt.transactionHash,
  },
  transactions,
  totals: {
    transactionCount: values.length,
    gasUsed: values
      .reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)
      .toString(),
    totalFeeWei: values
      .reduce((sum, item) => sum + BigInt(item.totalFeeWei), 0n)
      .toString(),
  },
  verification: { tokens: "pending", pool: "pending", urls: [] },
};
await mkdir(path.dirname(manifestPath), { recursive: true });
const temporary = `${manifestPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
await rename(temporary, manifestPath);
console.log(
  `Testnet market deployed with ${values.length} successful transactions`,
);
console.log(`Market manifest written: ${path.relative(root, manifestPath)}`);
