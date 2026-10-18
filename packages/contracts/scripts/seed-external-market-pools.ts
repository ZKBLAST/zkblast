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
  parseAbi,
  parseUnits,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type TransactionRecord = Readonly<{
  hash: Hash;
  blockNumber: number;
  blockHash: Hash;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
}>;
type MarketRecord = {
  baseAddress: Address;
  quoteAddress: Address;
  poolAddress?: Address;
  baseAmountRaw: string;
  quoteAmountRaw: string;
  transactions: Record<string, TransactionRecord>;
};
type Journal = {
  schemaVersion: 1;
  protocol: "ZKBLAST";
  environment: "testnet";
  chainId: number;
  updatedAt: string;
  markets: Record<string, MarketRecord>;
};

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const journalPath = path.resolve(
  root,
  "deployments/testnet/external-market-pools.private.json",
);
const publicPath = path.resolve(
  root,
  "deployments/testnet/external-market-pools.json",
);
const mappingPath = path.resolve(root, "data/testnet-market-mappings.json");
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw new Error(message);
};

assert(required("APP_ENV") === "testnet", "This workflow is testnet-only");
const chainId = Number(required("CHAIN_ID"));
assert(chainId === 46630, "External market pools require chain 46630");
const rpcUrl = required("RPC_URL");
const governanceKey = required("GOVERNANCE_PRIVATE_KEY") as Hex;
assert(/^0x[\da-f]{64}$/iu.test(governanceKey), "Invalid governance key");
const quoteAddress = getAddress(required("EXECUTION_USDG_ADDRESS"));
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
const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as {
  chainId: number;
  mappings: readonly {
    symbol: string;
    address: Address;
    decimals: number;
  }[];
};
assert(protocol.chainId === chainId, "Protocol manifest chain mismatch");
assert(mapping.chainId === chainId, "Token mapping chain mismatch");
const account = privateKeyToAccount(governanceKey);
assert(
  account.address === getAddress(protocol.governanceAddress),
  "Governance signer mismatch",
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
assert((await publicClient.getChainId()) === chainId, "RPC chain mismatch");

const factoryAbi = parseAbi([
  "function createPool(address tokenA,address tokenB,uint8 model,uint24 feePips,uint16 binStepBps) returns (address pool)",
  "event PoolCreated(bytes32 indexed poolId,address indexed pool,(address token0,address token1,uint8 model,uint24 feePips,uint16 binStepBps) key)",
]);
const tokenAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function addLiquidity(uint256 amount0,uint256 amount1,uint256 minimumShares,address recipient,uint256 deadline) returns (uint256 shares)",
]);
const quoterAbi = parseAbi([
  "function quoteDammExactInput(address pool,address tokenIn,uint256 amountIn) view returns (uint256 amountOut,uint256 totalFee)",
]);
const routerAbi = parseAbi([
  "function swapDammExactInput(address pool,address tokenIn,uint256 amountIn,uint256 minimumAmountOut,address recipient,uint256 deadline) returns (uint256 amountOut)",
]);

let journal: Journal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  assert(journal.chainId === chainId, "Journal chain mismatch");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  journal = {
    schemaVersion: 1,
    protocol: "ZKBLAST",
    environment: "testnet",
    chainId,
    updatedAt: new Date().toISOString(),
    markets: {},
  };
}

function receiptRecord(receipt: TransactionReceipt): TransactionRecord {
  return {
    hash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  };
}

async function saveJournal() {
  journal.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.local.json`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, journalPath);
}

async function write(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert(receipt.status === "success", `${functionName} reverted`);
  return receipt;
}

for (const token of mapping.mappings) {
  assert(token.decimals === 18, `${token.symbol} decimals changed`);
  const baseAddress = getAddress(token.address);
  const baseAmount = parseUnits("0.01", token.decimals);
  const quoteAmount = parseUnits("2", 6);
  const market = (journal.markets[token.symbol] ??= {
    baseAddress,
    quoteAddress,
    baseAmountRaw: baseAmount.toString(),
    quoteAmountRaw: quoteAmount.toString(),
    transactions: {},
  });
  assert(market.baseAddress === baseAddress, `${token.symbol} address changed`);
  if (!market.poolAddress) {
    const receipt = await write(
      getAddress(protocol.integration.poolFactory),
      factoryAbi,
      "createPool",
      [baseAddress, quoteAddress, 0, 3_000, 0],
    );
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: factoryAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "PoolCreated")
          market.poolAddress = getAddress(decoded.args.pool);
      } catch {
        /* Unrelated receipt log. */
      }
    }
    assert(market.poolAddress, `${token.symbol} PoolCreated event missing`);
    market.transactions.createPool = receiptRecord(receipt);
    await saveJournal();
  }
  const pool = market.poolAddress;
  if (!market.transactions.approveBase) {
    const receipt = await write(baseAddress, tokenAbi, "approve", [
      pool,
      baseAmount,
    ]);
    market.transactions.approveBase = receiptRecord(receipt);
    await saveJournal();
  }
  if (!market.transactions.approveQuote) {
    const receipt = await write(quoteAddress, tokenAbi, "approve", [
      pool,
      quoteAmount,
    ]);
    market.transactions.approveQuote = receiptRecord(receipt);
    await saveJournal();
  }
  if (!market.transactions.addLiquidity) {
    const [token0, token1] = await Promise.all([
      publicClient.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token0",
      }),
      publicClient.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token1",
      }),
    ]);
    assert(
      new Set([token0, token1]).size === 2 &&
        [token0, token1].includes(baseAddress) &&
        [token0, token1].includes(quoteAddress),
      `${token.symbol} pool token mismatch`,
    );
    const amount0 = token0 === baseAddress ? baseAmount : quoteAmount;
    const amount1 = token1 === quoteAddress ? quoteAmount : baseAmount;
    const receipt = await write(pool, poolAbi, "addLiquidity", [
      amount0,
      amount1,
      1n,
      account.address,
      BigInt(Math.floor(Date.now() / 1_000) + 1_200),
    ]);
    market.transactions.addLiquidity = receiptRecord(receipt);
    await saveJournal();
  }
  const swapAmount = parseUnits("0.001", token.decimals);
  if (!market.transactions.approveSwapBase) {
    const receipt = await write(baseAddress, tokenAbi, "approve", [
      getAddress(protocol.integration.swapRouter),
      swapAmount,
    ]);
    market.transactions.approveSwapBase = receiptRecord(receipt);
    await saveJournal();
  }
  if (!market.transactions.swapE2E) {
    const quote = await publicClient.readContract({
      address: getAddress(protocol.integration.poolQuoter),
      abi: quoterAbi,
      functionName: "quoteDammExactInput",
      args: [pool, baseAddress, swapAmount],
    });
    assert(quote[0] > 0n, `${token.symbol} quote returned zero output`);
    const receipt = await write(
      getAddress(protocol.integration.swapRouter),
      routerAbi,
      "swapDammExactInput",
      [
        pool,
        baseAddress,
        swapAmount,
        (quote[0] * 99n) / 100n,
        account.address,
        BigInt(Math.floor(Date.now() / 1_000) + 1_200),
      ],
    );
    market.transactions.swapE2E = receiptRecord(receipt);
    await saveJournal();
  }
}

const publicArtifact = {
  ...journal,
  governanceAddress: account.address,
  markets: Object.fromEntries(
    Object.entries(journal.markets).map(([symbol, market]) => [
      symbol,
      {
        ...market,
        feePips: 3_000,
        model: "DAMM",
      },
    ]),
  ),
};
const publicTemporary = `${publicPath}.local.json`;
await writeFile(
  publicTemporary,
  `${JSON.stringify(publicArtifact, null, 2)}\n`,
);
await rename(publicTemporary, publicPath);
console.log(JSON.stringify({ seeded: Object.keys(journal.markets).length }));
