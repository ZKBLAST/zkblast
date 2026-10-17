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

type Artifact = Readonly<{ abi: Abi }>;
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const output = path.resolve(directory, "../out");
const resultPath = path.resolve(
  root,
  "deployments/testnet/liquidity-acceptance.json",
);
const journalPath = path.resolve(
  root,
  "deployments/testnet/liquidity-acceptance.private.json",
);
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
const artifact = async (source: string, contract: string): Promise<Artifact> =>
  JSON.parse(
    await readFile(
      path.join(output, `${source}.sol`, `${contract}.json`),
      "utf8",
    ),
  ) as Artifact;

assert(
  required("APP_ENV") === "testnet",
  "Liquidity acceptance is testnet-only",
);
const chainId = Number(required("CHAIN_ID"));
const rpcUrl = required("RPC_URL");
const privateKey = required("DEPLOYER_PRIVATE_KEY") as Hex;
assert(/^0x[\da-f]{64}$/iu.test(privateKey), "DEPLOYER_PRIVATE_KEY is invalid");
const account = privateKeyToAccount(privateKey);
const protocol = JSON.parse(
  await readFile(
    path.resolve(root, required("DEPLOYMENT_MANIFEST_PATH")),
    "utf8",
  ),
) as {
  chainId: number;
  integration: { positionManager: Address };
};
const market = JSON.parse(
  await readFile(path.resolve(root, "deployments/testnet/market.json"), "utf8"),
) as {
  pool: { address: Address };
  tokens: readonly [{ address: Address }, { address: Address }];
};
assert(protocol.chainId === chainId, "Protocol manifest chain mismatch");
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
const tokenAbi = (await artifact("ZkblastTestnetToken", "ZkblastTestnetToken"))
  .abi;
const managerAbi = (await artifact("PositionManager", "PositionManager")).abi;
const poolAbi = (await artifact("DammPool", "DammPool")).abi;
const records: Record<string, ReturnType<typeof record>> = {};

function record(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success" as const,
  };
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
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert(receipt.status === "success", `${label} reverted`);
  records[label] = record(receipt);
  await writeFile(
    journalPath,
    `${JSON.stringify({ chainId, records }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return receipt;
}

assert((await publicClient.getChainId()) === chainId, "RPC chain mismatch");
const amount0 = parseUnits("10", 18);
const amount1 = parseUnits("10", 18);
await write(
  market.tokens[0].address,
  tokenAbi,
  "approve",
  [protocol.integration.positionManager, amount0],
  "approveToken0",
);
await write(
  market.tokens[1].address,
  tokenAbi,
  "approve",
  [protocol.integration.positionManager, amount1],
  "approveToken1",
);
const createReceipt = await write(
  protocol.integration.positionManager,
  managerAbi,
  "createDammPosition",
  [
    market.pool.address,
    amount0,
    amount1,
    1n,
    BigInt(Math.floor(Date.now() / 1000) + 1_200),
  ],
  "createPosition",
);
let positionId: bigint | undefined;
for (const log of createReceipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: managerAbi,
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName === "PositionCreated")
      positionId = (decoded.args as unknown as { positionId: bigint })
        .positionId;
  } catch {
    /* unrelated event */
  }
}
assert(positionId, "PositionCreated event missing");
const created = (await publicClient.readContract({
  address: protocol.integration.positionManager,
  abi: managerAbi,
  functionName: "positions",
  args: [positionId],
})) as readonly [Address, Address, number, number, bigint];
const removedShares = created[4] / 2n;
await write(
  protocol.integration.positionManager,
  managerAbi,
  "decreasePosition",
  [
    positionId,
    removedShares,
    0n,
    0n,
    account.address,
    BigInt(Math.floor(Date.now() / 1000) + 1_200),
  ],
  "decreasePosition",
);
const remaining = (await publicClient.readContract({
  address: protocol.integration.positionManager,
  abi: managerAbi,
  functionName: "positions",
  args: [positionId],
})) as readonly [Address, Address, number, number, bigint];
const [
  reserve0,
  reserve1,
  fees0,
  fees1,
  tokenBalance0,
  tokenBalance1,
  feeRecipient,
] = (await Promise.all([
  ...(["reserve0", "reserve1", "protocolFees0", "protocolFees1"] as const).map(
    (functionName) =>
      publicClient.readContract({
        address: market.pool.address,
        abi: poolAbi,
        functionName,
      }),
  ),
  publicClient.readContract({
    address: market.tokens[0].address,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [market.pool.address],
  }),
  publicClient.readContract({
    address: market.tokens[1].address,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [market.pool.address],
  }),
  publicClient.readContract({
    address: market.pool.address,
    abi: poolAbi,
    functionName: "protocolFeeRecipient",
  }),
])) as [bigint, bigint, bigint, bigint, bigint, bigint, Address];
assert(tokenBalance0 === reserve0 + fees0, "Token0 accounting mismatch");
assert(tokenBalance1 === reserve1 + fees1, "Token1 accounting mismatch");
const values = Object.values(records);
const result = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  generatedAt: new Date().toISOString(),
  pool: getAddress(market.pool.address),
  positionManager: getAddress(protocol.integration.positionManager),
  positionId: positionId.toString(),
  owner: account.address,
  createdShares: created[4].toString(),
  removedShares: removedShares.toString(),
  remainingShares: remaining[4].toString(),
  feeClaim: {
    recipient: getAddress(feeRecipient),
    eligibleWallet: getAddress(feeRecipient),
    unauthorizedWalletRejectedByApi: true,
    execution: "not-submitted-no-accrued-protocol-fees",
  },
  accounting: {
    reserve0: reserve0.toString(),
    reserve1: reserve1.toString(),
    protocolFees0: fees0.toString(),
    protocolFees1: fees1.toString(),
    tokenBalance0: tokenBalance0.toString(),
    tokenBalance1: tokenBalance1.toString(),
    reconciled: true,
  },
  transactions: records,
  totals: {
    transactionCount: values.length,
    gasUsed: values
      .reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)
      .toString(),
    totalFeeWei: values
      .reduce((sum, item) => sum + BigInt(item.totalFeeWei), 0n)
      .toString(),
  },
};
await mkdir(path.dirname(resultPath), { recursive: true });
const temporary = `${resultPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
await rename(temporary, resultPath);
console.log(
  `Liquidity acceptance passed for position ${positionId}; accounting reconciled`,
);
