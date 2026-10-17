import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHash,
  type Address,
  type Hash,
} from "viem";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
assert(required("APP_ENV") === "testnet", "Testnet environment required");
const chainId = Number(required("CHAIN_ID"));
const explorerUrl = required("BLOCK_EXPLORER_URL");
const protocol = JSON.parse(
  await readFile(
    path.resolve(root, required("DEPLOYMENT_MANIFEST_PATH")),
    "utf8",
  ),
) as { integration: { poolRegistry: Address } };
const market = JSON.parse(
  await readFile(path.resolve(root, "deployments/testnet/market.json"), "utf8"),
) as {
  chainId: number;
  tokens: Array<{ address: Address }>;
  pool: {
    address: Address;
    initialLiquidity0: string;
    initialLiquidity1: string;
  };
  transactions: Record<
    string,
    { hash: Hash; gasUsed: string; totalFeeWei: string; status: string }
  >;
  totals: { transactionCount: number; gasUsed: string; totalFeeWei: string };
  verification: { tokens: string; pool: string };
};
assert(market.chainId === chainId, "Market chain mismatch");
assert(
  market.verification.tokens === "verified" &&
    market.verification.pool === "verified",
  "Verification status incomplete",
);
const client = createPublicClient({ transport: http(required("RPC_URL")) });
assert((await client.getChainId()) === chainId, "RPC chain mismatch");
const values = Object.values(market.transactions);
assert(
  values.length === 8 && market.totals.transactionCount === 8,
  "Transaction count mismatch",
);
let gasUsed = 0n;
let totalFee = 0n;
for (const transaction of values) {
  assert(isHash(transaction.hash), "Invalid transaction hash");
  const receipt = await client.getTransactionReceipt({
    hash: transaction.hash,
  });
  assert(
    receipt.status === "success",
    `Transaction reverted: ${transaction.hash}`,
  );
  assert(
    receipt.gasUsed.toString() === transaction.gasUsed,
    `Gas mismatch: ${transaction.hash}`,
  );
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  assert(
    fee.toString() === transaction.totalFeeWei,
    `Fee mismatch: ${transaction.hash}`,
  );
  gasUsed += receipt.gasUsed;
  totalFee += fee;
}
assert(gasUsed.toString() === market.totals.gasUsed, "Aggregate gas mismatch");
assert(
  totalFee.toString() === market.totals.totalFeeWei,
  "Aggregate fee mismatch",
);
for (const address of [
  ...market.tokens.map((token) => token.address),
  market.pool.address,
]) {
  assert(
    isAddress(address) && (await client.getBytecode({ address })),
    `Missing code: ${address}`,
  );
  const endpoint = new URL("/api", explorerUrl);
  endpoint.search = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address,
  }).toString();
  const response = await fetch(endpoint);
  const payload = (await response.json()) as {
    status?: string;
    result?: Array<{ SourceCode?: string }>;
  };
  assert(
    response.ok &&
      payload.status === "1" &&
      Boolean(payload.result?.[0]?.SourceCode),
    `Explorer source missing: ${address}`,
  );
}
const registered = await client.readContract({
  address: protocol.integration.poolRegistry,
  abi: [
    {
      type: "function",
      name: "isRegisteredPool",
      stateMutability: "view",
      inputs: [{ type: "address" }],
      outputs: [{ type: "bool" }],
    },
  ],
  functionName: "isRegisteredPool",
  args: [market.pool.address],
});
assert(registered, "Pool is not registered");
const poolAbi = [
  {
    type: "function",
    name: "reserve0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint112" }],
  },
  {
    type: "function",
    name: "reserve1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint112" }],
  },
] as const;
const [reserve0, reserve1] = await Promise.all([
  client.readContract({
    address: market.pool.address,
    abi: poolAbi,
    functionName: "reserve0",
  }),
  client.readContract({
    address: market.pool.address,
    abi: poolAbi,
    functionName: "reserve1",
  }),
]);
assert(reserve0 > 0n && reserve1 > 0n, "Pool reserves are empty");
console.log(
  `Verified testnet market: 3 contracts, 8 receipts, ${market.totals.gasUsed} gas`,
);
