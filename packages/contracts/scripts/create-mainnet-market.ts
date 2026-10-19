import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 4663;
const CONFIRMATION = "CREATE_ZKBLAST_MAINNET_WETH_USDG_POOL";
const FEE_PIPS = 3_000;
const MODEL = 0;

type Artifact = Readonly<{ abi: Abi }>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function privateKey(name: string): Hex {
  const value = required(name) as Hex;
  invariant(/^0x[\da-f]{64}$/iu.test(value), `${name} is invalid`);
  return value;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const output = path.resolve(directory, "../out");
const manifestPath = path.resolve(root, "deployments/mainnet/manifest.json");
const marketPath = path.resolve(root, "deployments/mainnet/market.json");
const privateJournalPath = path.resolve(
  root,
  "deployments/mainnet/market-creation.private.json",
);

invariant(required("APP_ENV") === "mainnet", "Mainnet environment required");
invariant(Number(required("CHAIN_ID")) === CHAIN_ID, "Chain 4663 required");

const deployment = JSON.parse(await readFile(manifestPath, "utf8")) as {
  environment: string;
  chainId: number;
  governanceAddress: Address;
  integration: { poolFactory: Address; poolRegistry: Address };
};
invariant(
  deployment.environment === "mainnet" && deployment.chainId === CHAIN_ID,
  "Mainnet deployment manifest mismatch",
);

const token0Candidate = getAddress(required("EXECUTION_WETH_ADDRESS"));
const token1Candidate = getAddress(required("EXECUTION_USDG_ADDRESS"));
const token0 =
  token0Candidate.toLowerCase() < token1Candidate.toLowerCase()
    ? token0Candidate
    : token1Candidate;
const token1 = token0 === token0Candidate ? token1Candidate : token0Candidate;
const safe = getAddress(deployment.governanceAddress);
const relayAccount = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const signerAccounts = [
  privateKeyToAccount(privateKey("GOVERNANCE_PRIVATE_KEY")),
  privateKeyToAccount(privateKey("UPGRADER_PRIVATE_KEY")),
].sort((left, right) =>
  left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
);

const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: CHAIN_ID,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({
  account: relayAccount,
  chain,
  transport: http(rpcUrl),
});
invariant((await client.getChainId()) === CHAIN_ID, "RPC chain mismatch");
invariant(
  (await client.getBalance({ address: relayAccount.address })) > 0n,
  "Relayer has no native gas",
);

const [factoryArtifactFile, registryArtifactFile] = await Promise.all([
  readFile(path.join(output, "PoolFactory.sol", "PoolFactory.json"), "utf8"),
  readFile(path.join(output, "PoolRegistry.sol", "PoolRegistry.json"), "utf8"),
]);
const factoryArtifact = JSON.parse(factoryArtifactFile) as Artifact;
const registryArtifact = JSON.parse(registryArtifactFile) as Artifact;

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
]);
const poolAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function totalShares() view returns (uint256)",
  "function reserve0() view returns (uint112)",
  "function reserve1() view returns (uint112)",
]);

const [safeOwners, threshold, safeNonce, token0Code, token1Code] =
  await Promise.all([
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
    client.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    client.getBytecode({ address: token0 }),
    client.getBytecode({ address: token1 }),
  ]);
invariant(threshold === 2n, "Safe threshold must remain two");
const normalizedOwners = new Set(
  safeOwners.map((owner) => owner.toLowerCase()),
);
invariant(
  signerAccounts.every((account) =>
    normalizedOwners.has(account.address.toLowerCase()),
  ),
  "Configured signers are not both Safe owners",
);
invariant(token0Code && token0Code !== "0x", "Token0 runtime missing");
invariant(token1Code && token1Code !== "0x", "Token1 runtime missing");

const factory = getAddress(deployment.integration.poolFactory);
const registry = getAddress(deployment.integration.poolRegistry);
const poolKey = {
  token0,
  token1,
  model: MODEL,
  feePips: FEE_PIPS,
  binStepBps: 0,
};
const predictedPool = getAddress(
  (await client.readContract({
    address: factory,
    abi: factoryArtifact.abi,
    functionName: "predictPoolAddress",
    args: [poolKey, safe],
  })) as Address,
);
invariant(
  !(await client.getBytecode({ address: predictedPool })),
  "WETH/USDG pool already exists",
);

const factoryCall = encodeFunctionData({
  abi: factoryArtifact.abi,
  functionName: "createPool",
  args: [token0, token1, MODEL, FEE_PIPS, 0],
});
const safeTransaction = {
  to: factory,
  value: 0n,
  data: factoryCall,
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: safeNonce,
} as const;
const safeArguments = [
  safeTransaction.to,
  safeTransaction.value,
  safeTransaction.data,
  safeTransaction.operation,
  safeTransaction.safeTxGas,
  safeTransaction.baseGas,
  safeTransaction.gasPrice,
  safeTransaction.gasToken,
  safeTransaction.refundReceiver,
  safeTransaction.nonce,
] as const;
const safeExecutionArguments = [
  safeTransaction.to,
  safeTransaction.value,
  safeTransaction.data,
  safeTransaction.operation,
  safeTransaction.safeTxGas,
  safeTransaction.baseGas,
  safeTransaction.gasPrice,
  safeTransaction.gasToken,
  safeTransaction.refundReceiver,
] as const;
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
  message: safeTransaction,
});
const onchainHash = await client.readContract({
  address: safe,
  abi: safeAbi,
  functionName: "getTransactionHash",
  args: safeArguments,
});
invariant(localHash === onchainHash, "Safe transaction hash mismatch");
const signatures = concatHex(
  await Promise.all(
    signerAccounts.map((account) =>
      account.signTypedData({
        domain,
        types,
        primaryType: "SafeTx",
        message: safeTransaction,
      }),
    ),
  ),
);
const execution = await client.simulateContract({
  address: safe,
  abi: safeAbi,
  functionName: "execTransaction",
  args: [...safeExecutionArguments, signatures],
  account: relayAccount,
});
invariant(execution.result === true, "Safe pool creation simulation failed");

console.log(`Pair: ${token0}/${token1}`);
console.log(`Predicted pool: ${predictedPool}`);
console.log(`Safe nonce: ${safeNonce}`);
console.log(`Safe transaction hash: ${onchainHash}`);
if (process.env.CONFIRM_MAINNET_POOL_CREATION !== CONFIRMATION) {
  console.log(
    `Simulation passed. Set CONFIRM_MAINNET_POOL_CREATION=${CONFIRMATION} to broadcast.`,
  );
  process.exit(0);
}

await mkdir(path.dirname(privateJournalPath), { recursive: true });
await writeFile(
  privateJournalPath,
  `${JSON.stringify({ chainId: CHAIN_ID, safe, safeNonce: safeNonce.toString(), safeTransactionHash: onchainHash, predictedPool, status: "broadcasting" }, null, 2)}\n`,
  { mode: 0o600 },
);
const hash = await wallet.writeContract(execution.request);
const receipt = await client.waitForTransactionReceipt({
  hash,
  confirmations: 1,
});
invariant(receipt.status === "success", "Pool creation transaction reverted");
let createdPool: Address | undefined;
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: factoryArtifact.abi,
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName === "PoolCreated") {
      createdPool = getAddress(
        (decoded.args as unknown as { pool: Address }).pool,
      );
    }
  } catch {
    // Logs emitted by the Safe and registry are outside this event boundary.
  }
}
invariant(createdPool === predictedPool, "Created pool address mismatch");
const [
  registered,
  actualFactory,
  actualToken0,
  actualToken1,
  actualFee,
  reserves,
] = await Promise.all([
  client.readContract({
    address: registry,
    abi: registryArtifact.abi,
    functionName: "isRegisteredPool",
    args: [createdPool],
  }),
  client.readContract({
    address: createdPool,
    abi: poolAbi,
    functionName: "factory",
  }),
  client.readContract({
    address: createdPool,
    abi: poolAbi,
    functionName: "token0",
  }),
  client.readContract({
    address: createdPool,
    abi: poolAbi,
    functionName: "token1",
  }),
  client.readContract({
    address: createdPool,
    abi: poolAbi,
    functionName: "feePips",
  }),
  Promise.all([
    client.readContract({
      address: createdPool,
      abi: poolAbi,
      functionName: "reserve0",
    }),
    client.readContract({
      address: createdPool,
      abi: poolAbi,
      functionName: "reserve1",
    }),
    client.readContract({
      address: createdPool,
      abi: poolAbi,
      functionName: "totalShares",
    }),
  ]),
]);
invariant(registered === true, "Pool is not registered");
invariant(getAddress(actualFactory) === factory, "Pool factory mismatch");
invariant(getAddress(actualToken0) === token0, "Pool token0 mismatch");
invariant(getAddress(actualToken1) === token1, "Pool token1 mismatch");
invariant(actualFee === FEE_PIPS, "Pool fee mismatch");
invariant(
  reserves.every((value) => value === 0n),
  "New pool is not empty",
);
const [
  token0Name,
  token0Symbol,
  token0Decimals,
  token1Name,
  token1Symbol,
  token1Decimals,
] = await Promise.all([
  client.readContract({ address: token0, abi: tokenAbi, functionName: "name" }),
  client.readContract({
    address: token0,
    abi: tokenAbi,
    functionName: "symbol",
  }),
  client.readContract({
    address: token0,
    abi: tokenAbi,
    functionName: "decimals",
  }),
  client.readContract({ address: token1, abi: tokenAbi, functionName: "name" }),
  client.readContract({
    address: token1,
    abi: tokenAbi,
    functionName: "symbol",
  }),
  client.readContract({
    address: token1,
    abi: tokenAbi,
    functionName: "decimals",
  }),
]);
const record = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "mainnet",
  chainId: CHAIN_ID,
  generatedAt: new Date().toISOString(),
  explorerUrl: required("BLOCK_EXPLORER_URL"),
  tokens: [
    {
      address: token0,
      name: token0Name,
      symbol: token0Symbol,
      decimals: token0Decimals,
    },
    {
      address: token1,
      name: token1Name,
      symbol: token1Symbol,
      decimals: token1Decimals,
    },
  ],
  pool: {
    address: createdPool,
    model: "damm",
    feePips: FEE_PIPS,
    feeBps: FEE_PIPS / 100,
    createdBlock: Number(receipt.blockNumber),
    liquidityStatus: "awaiting_initial_liquidity",
    reserve0: "0",
    reserve1: "0",
    totalShares: "0",
  },
  governance: {
    safe,
    safeNonce: safeNonce.toString(),
    safeTransactionHash: onchainHash,
  },
  transaction: {
    hash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  },
  verification: {
    registry: "verified",
    runtimeBytecodeHash: keccak256(
      (await client.getBytecode({ address: createdPool })) as Hex,
    ),
  },
};
const temporaryPath = `${marketPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
  mode: 0o644,
});
await rename(temporaryPath, marketPath);
await writeFile(
  privateJournalPath,
  `${JSON.stringify({ ...record, status: "complete" }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`Created and verified mainnet pool ${createdPool}`);
console.log(`Transaction: ${hash}`);
