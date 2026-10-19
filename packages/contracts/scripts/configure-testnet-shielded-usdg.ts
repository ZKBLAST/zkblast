import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type TransactionRecord = Readonly<{
  hash: Hex;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
}>;

type Manifest = Record<string, any> & {
  chainId: number;
  environment: string;
  generatedAt: string;
  governanceAddress: Address;
  totals: { transactionCount: number; gasUsed: string; totalFeeWei: string };
  shielded: {
    vault: Address;
    assets: Array<{
      address: Address;
      symbol: string;
      decimals: number;
      denominationRaw: string;
    }>;
  };
  contracts: {
    ZKBlastVault: {
      transactions: { configuration: TransactionRecord[] };
    };
  };
};

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const manifestPath = path.resolve(root, "deployments/testnet/manifest.json");
const evidencePath = path.resolve(
  root,
  "deployments/testnet/shielded-usdg.json",
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function atomicWrite(location: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(location), { recursive: true });
  const temporary = `${location}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, location);
}

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

assert(required("APP_ENV") === "testnet", "Workflow is testnet-only");
const chainId = Number(required("CHAIN_ID"));
assert(chainId === 46630, "Shielded USDG requires chain 46630");
const rpcUrl = required("RPC_URL");
const governanceKey = required("GOVERNANCE_PRIVATE_KEY") as Hex;
assert(/^0x[\da-f]{64}$/iu.test(governanceKey), "Invalid governance key");
const denomination = BigInt(required("SHIELDED_USDG_DENOMINATION_RAW"));
assert(denomination > 0n && denomination <= 2n ** 128n - 1n, "Invalid denomination");
const usdg = getAddress(required("EXECUTION_USDG_ADDRESS"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
assert(manifest.environment === "testnet", "Manifest environment mismatch");
assert(manifest.chainId === chainId, "Manifest chain mismatch");

const account = privateKeyToAccount(governanceKey);
assert(
  account.address === getAddress(manifest.governanceAddress),
  "Governance signer mismatch",
);
const vault = getAddress(manifest.shielded.vault);
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
assert((await client.getChainId()) === chainId, "RPC chain mismatch");
assert((await client.getBytecode({ address: usdg })) !== undefined, "USDG has no code");

const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const vaultAbi = parseAbi([
  "function assetConfig(address asset) view returns (uint128 denomination,bool enabled)",
  "function setAssetConfig(address asset,uint128 denomination,bool enabled)",
]);
const [symbol, decimals, current] = await Promise.all([
  client.readContract({ address: usdg, abi: tokenAbi, functionName: "symbol" }),
  client.readContract({ address: usdg, abi: tokenAbi, functionName: "decimals" }),
  client.readContract({
    address: vault,
    abi: vaultAbi,
    functionName: "assetConfig",
    args: [usdg],
  }),
]);
assert(symbol === "USDG", `Unexpected token symbol: ${symbol}`);
assert(decimals === 6, `Unexpected USDG decimals: ${decimals}`);

let transaction: TransactionRecord | null = null;
if (!current[1] || current[0] !== denomination) {
  const balance = await client.getBalance({ address: account.address });
  assert(balance > 0n, "Governance signer has no native gas balance");
  const { request } = await client.simulateContract({
    address: vault,
    abi: vaultAbi,
    functionName: "setAssetConfig",
    args: [usdg, denomination, true],
    account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert(receipt.status === "success", "USDG configuration reverted");
  transaction = record(receipt);
}

const verified = await client.readContract({
  address: vault,
  abi: vaultAbi,
  functionName: "assetConfig",
  args: [usdg],
});
assert(verified[1] && verified[0] === denomination, "USDG configuration verification failed");

const asset = {
  address: usdg,
  symbol: "USDG",
  decimals,
  denominationRaw: denomination.toString(),
};
const assetIndex = manifest.shielded.assets.findIndex(
  (entry) => getAddress(entry.address) === usdg,
);
if (assetIndex === -1) manifest.shielded.assets.push(asset);
else manifest.shielded.assets[assetIndex] = asset;

if (transaction) {
  manifest.contracts.ZKBlastVault.transactions.configuration.push(transaction);
  manifest.totals.transactionCount += 1;
  manifest.totals.gasUsed = (
    BigInt(manifest.totals.gasUsed) + BigInt(transaction.gasUsed)
  ).toString();
  manifest.totals.totalFeeWei = (
    BigInt(manifest.totals.totalFeeWei) + BigInt(transaction.totalFeeWei)
  ).toString();
}
manifest.generatedAt = new Date().toISOString();

await atomicWrite(manifestPath, manifest);
await atomicWrite(evidencePath, {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  configuredAt: manifest.generatedAt,
  vault,
  asset,
  enabled: true,
  transaction,
  result: transaction ? "configured" : "already-configured",
});

console.log(
  transaction
    ? `Shielded USDG enabled: ${transaction.hash}`
    : "Shielded USDG already enabled; manifest reconciled",
);
