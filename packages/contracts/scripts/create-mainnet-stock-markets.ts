import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 4663;
const CONFIRMATION = "CREATE_ZKBLAST_MAINNET_STOCK_POOLS";
const FEE_PIPS = 3_000;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function key(name: string): Hex {
  const value = required(name) as Hex;
  invariant(/^0x[\da-f]{64}$/iu.test(value), `${name} is invalid`);
  return value;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const artifact = JSON.parse(
  await readFile(
    path.resolve(directory, "../out/PoolFactory.sol/PoolFactory.json"),
    "utf8",
  ),
) as { abi: Abi };
const deployment = JSON.parse(
  await readFile(
    path.resolve(root, "deployments/mainnet/manifest.json"),
    "utf8",
  ),
) as {
  environment: string;
  chainId: number;
  governanceAddress: Address;
  integration: { poolFactory: Address; poolRegistry: Address };
};
const catalogue = JSON.parse(
  await readFile(path.resolve(root, "data/mainnet-stock-markets.json"), "utf8"),
) as {
  version: number;
  chainId: number;
  quoteSymbol: string;
  markets: {
    symbol: string;
    name: string;
    address: Address;
    logoUrl: string;
  }[];
};
invariant(required("APP_ENV") === "mainnet", "Mainnet environment required");
invariant(Number(required("CHAIN_ID")) === CHAIN_ID, "Chain 4663 required");
invariant(
  deployment.environment === "mainnet" && deployment.chainId === CHAIN_ID,
  "Deployment manifest mismatch",
);
invariant(
  catalogue.version === 1 &&
    catalogue.chainId === CHAIN_ID &&
    catalogue.quoteSymbol === "USDG" &&
    catalogue.markets.length > 0,
  "Stock market catalogue mismatch",
);

const relay = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
const signers = [
  privateKeyToAccount(key("GOVERNANCE_PRIVATE_KEY")),
  privateKeyToAccount(key("UPGRADER_PRIVATE_KEY")),
].sort((left, right) =>
  left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
);
const safe = getAddress(deployment.governanceAddress);
const factory = getAddress(deployment.integration.poolFactory);
const registry = getAddress(deployment.integration.poolRegistry);
const quote = getAddress(required("EXECUTION_USDG_ADDRESS"));
const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: CHAIN_ID,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({
  account: relay,
  chain,
  transport: http(rpcUrl),
});
invariant((await client.getChainId()) === CHAIN_ID, "RPC chain mismatch");

const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) returns (bool success)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function isRegisteredPool(address pool) view returns (bool)",
]);
const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function reserve0() view returns (uint112)",
  "function reserve1() view returns (uint112)",
  "function totalShares() view returns (uint256)",
]);
const [owners, threshold] = await Promise.all([
  client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getOwners",
  }),
  client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getThreshold",
  }),
]);
invariant(threshold === 2n, "Safe threshold must remain two");
const ownerSet = new Set(owners.map((owner) => owner.toLowerCase()));
invariant(
  signers.every((signer) => ownerSet.has(signer.address.toLowerCase())),
  "Configured signers are not Safe owners",
);

type TransactionRecord = Readonly<{
  hash: Hex;
  blockNumber: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
}>;
type MarketRecord = {
  symbol: string;
  name: string;
  baseAddress: Address;
  quoteAddress: Address;
  poolAddress: Address;
  feePips: number;
  model: "DAMM";
  liquidityStatus: "awaiting_initial_liquidity";
  transaction?: TransactionRecord;
};
type Journal = {
  schemaVersion: 1;
  protocol: "ZKBLAST";
  environment: "mainnet";
  chainId: 4663;
  safe: Address;
  updatedAt: string;
  markets: Record<string, MarketRecord>;
};
const journalPath = path.resolve(
  root,
  "deployments/mainnet/stock-market-pools.private.json",
);
const publicPath = path.resolve(
  root,
  "deployments/mainnet/stock-market-pools.json",
);
let journal: Journal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  invariant(
    journal.chainId === CHAIN_ID && journal.safe === safe,
    "Journal mismatch",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  journal = {
    schemaVersion: 1,
    protocol: "ZKBLAST",
    environment: "mainnet",
    chainId: CHAIN_ID,
    safe,
    updatedAt: new Date().toISOString(),
    markets: {},
  };
}
async function saveJournal() {
  journal.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, journalPath);
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
async function safeRequest(data: Hex) {
  const nonce = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "nonce",
  });
  const transaction = {
    to: factory,
    value: 0n,
    data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  } as const;
  const hashArguments = [
    transaction.to,
    transaction.value,
    transaction.data,
    transaction.operation,
    transaction.safeTxGas,
    transaction.baseGas,
    transaction.gasPrice,
    transaction.gasToken,
    transaction.refundReceiver,
    transaction.nonce,
  ] as const;
  const executionArguments = hashArguments.slice(0, 9) as unknown as readonly [
    Address,
    bigint,
    Hex,
    number,
    bigint,
    bigint,
    bigint,
    Address,
    Address,
  ];
  const domain = { chainId: CHAIN_ID, verifyingContract: safe } as const;
  const types = {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  } as const;
  const localHash = hashTypedData({
    domain,
    types,
    primaryType: "SafeTx",
    message: transaction,
  });
  const onchainHash = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: hashArguments,
  });
  invariant(localHash === onchainHash, "Safe transaction hash mismatch");
  const signatures = concatHex(
    await Promise.all(
      signers.map((signer) =>
        signer.signTypedData({
          domain,
          types,
          primaryType: "SafeTx",
          message: transaction,
        }),
      ),
    ),
  );
  const simulation = await client.simulateContract({
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args: [...executionArguments, signatures],
    account: relay,
  });
  invariant(simulation.result === true, "Safe execution simulation failed");
  return {
    request: simulation.request,
    nonce,
    safeTransactionHash: onchainHash,
  };
}

const seen = new Set<string>();
for (const definition of catalogue.markets) {
  invariant(
    !seen.has(definition.symbol),
    `Duplicate stock symbol ${definition.symbol}`,
  );
  seen.add(definition.symbol);
  const base = getAddress(definition.address);
  invariant(base !== quote, `${definition.symbol} equals quote token`);
  const [code, name, symbol, decimals, supply] = await Promise.all([
    client.getBytecode({ address: base }),
    client.readContract({ address: base, abi: tokenAbi, functionName: "name" }),
    client.readContract({
      address: base,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: base,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.readContract({
      address: base,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
  ]);
  invariant(
    code && code !== "0x" && supply > 0n,
    `${definition.symbol} token invalid`,
  );
  invariant(
    symbol === definition.symbol && name === definition.name && decimals === 18,
    `${definition.symbol} metadata mismatch`,
  );
  const token0 = base.toLowerCase() < quote.toLowerCase() ? base : quote;
  const token1 = token0 === base ? quote : base;
  const poolAddress = getAddress(
    (await client.readContract({
      address: factory,
      abi: artifact.abi,
      functionName: "predictPoolAddress",
      args: [
        { token0, token1, model: 0, feePips: FEE_PIPS, binStepBps: 0 },
        safe,
      ],
    })) as Address,
  );
  const existingCode = await client.getBytecode({ address: poolAddress });
  if (!existingCode || existingCode === "0x") {
    const data = encodeFunctionData({
      abi: artifact.abi,
      functionName: "createPool",
      args: [base, quote, 0, FEE_PIPS, 0],
    });
    const prepared = await safeRequest(data);
    console.log(
      `${definition.symbol}: predicted ${poolAddress}, Safe nonce ${prepared.nonce}`,
    );
    if (process.env.CONFIRM_MAINNET_STOCK_POOLS !== CONFIRMATION) continue;
    const hash = await wallet.writeContract(prepared.request);
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    invariant(
      receipt.status === "success",
      `${definition.symbol} pool transaction reverted`,
    );
    journal.markets[definition.symbol] = {
      symbol: definition.symbol,
      name: definition.name,
      baseAddress: base,
      quoteAddress: quote,
      poolAddress,
      feePips: FEE_PIPS,
      model: "DAMM",
      liquidityStatus: "awaiting_initial_liquidity",
      transaction: receiptRecord(receipt),
    };
    await saveJournal();
  } else {
    journal.markets[definition.symbol] ??= {
      symbol: definition.symbol,
      name: definition.name,
      baseAddress: base,
      quoteAddress: quote,
      poolAddress,
      feePips: FEE_PIPS,
      model: "DAMM",
      liquidityStatus: "awaiting_initial_liquidity",
    };
  }
  const [
    registered,
    actualFactory,
    actualToken0,
    actualToken1,
    fee,
    reserve0,
    reserve1,
    shares,
    runtime,
  ] = await Promise.all([
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "isRegisteredPool",
      args: [poolAddress],
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "factory",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token0",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "token1",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "feePips",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "reserve0",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "reserve1",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "totalShares",
    }),
    client.getBytecode({ address: poolAddress }),
  ]);
  invariant(
    registered && getAddress(actualFactory) === factory,
    `${definition.symbol} registration mismatch`,
  );
  invariant(
    getAddress(actualToken0) === token0 &&
      getAddress(actualToken1) === token1 &&
      fee === FEE_PIPS,
    `${definition.symbol} pool mismatch`,
  );
  invariant(
    reserve0 === 0n && reserve1 === 0n && shares === 0n && runtime,
    `${definition.symbol} pool is not empty`,
  );
  Object.assign(journal.markets[definition.symbol]!, {
    runtimeBytecodeHash: keccak256(runtime),
  });
  await saveJournal();
}

if (process.env.CONFIRM_MAINNET_STOCK_POOLS !== CONFIRMATION) {
  console.log(
    `Simulations passed. Set CONFIRM_MAINNET_STOCK_POOLS=${CONFIRMATION} to broadcast.`,
  );
  process.exit(0);
}
const publicTemporary = `${publicPath}.tmp`;
await writeFile(
  publicTemporary,
  `${JSON.stringify({ ...journal, explorerUrl: required("BLOCK_EXPLORER_URL") }, null, 2)}\n`,
  { mode: 0o644 },
);
await rename(publicTemporary, publicPath);
console.log(
  `Created and verified ${Object.keys(journal.markets).length} mainnet stock pools`,
);
