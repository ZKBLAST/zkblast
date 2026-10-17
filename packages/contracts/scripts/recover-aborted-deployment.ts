import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const environment = required("APP_ENV");
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be testnet or mainnet");
}
const chainId = Number(required("CHAIN_ID"));
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const manifest = JSON.parse(
  await readFile(
    path.resolve(repositoryRoot, required("DEPLOYMENT_MANIFEST_PATH")),
    "utf8",
  ),
) as {
  deployerAddress: `0x${string}`;
  contracts: Record<
    string,
    {
      transactions: {
        implementationDeployment: { hash: string };
        proxyDeploymentAndInitialization: { hash: string } | null;
      };
    }
  >;
};
const successfulHashes = new Set(
  Object.values(manifest.contracts)
    .flatMap(({ transactions }) => [
      transactions.implementationDeployment,
      ...(transactions.proxyDeploymentAndInitialization
        ? [transactions.proxyDeploymentAndInitialization]
        : []),
    ])
    .map(({ hash }) => hash.toLowerCase()),
);

const explorer = new URL("/api", required("BLOCK_EXPLORER_URL"));
explorer.search = new URLSearchParams({
  module: "account",
  action: "txlist",
  address: manifest.deployerAddress,
  startblock: "0",
  endblock: "999999999",
  sort: "desc",
}).toString();
const response = await fetch(explorer);
if (!response.ok) throw new Error("Explorer transaction query failed");
const payload = (await response.json()) as {
  status: string;
  result: Array<{
    hash: string;
    nonce: string;
    blockNumber: string;
    blockHash: string;
    contractAddress: string;
    txreceipt_status: string;
    gasUsed: string;
    gasPrice: string;
  }>;
};
if (payload.status !== "1" || !Array.isArray(payload.result)) {
  throw new Error("Explorer returned an invalid transaction history");
}
const recovered = payload.result
  .filter(
    (transaction) =>
      transaction.contractAddress &&
      !successfulHashes.has(transaction.hash.toLowerCase()),
  )
  .map((transaction) => ({
    hash: transaction.hash,
    nonce: Number(transaction.nonce),
    blockNumber: Number(transaction.blockNumber),
    blockHash: transaction.blockHash,
    contractAddress: getAddress(transaction.contractAddress),
    status: transaction.txreceipt_status === "1" ? "success" : "reverted",
    gasUsed: transaction.gasUsed,
    effectiveGasPriceWei: transaction.gasPrice,
    totalFeeWei: (
      BigInt(transaction.gasUsed) * BigInt(transaction.gasPrice)
    ).toString(),
  }));

const outputPath = path.resolve(
  repositoryRoot,
  `deployments/${environment}/aborted-deployment-recovery.private.json`,
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      protocol: "ZKBLAST",
      environment,
      chainId,
      deployerAddress: manifest.deployerAddress,
      recoveredAt: new Date().toISOString(),
      transactions: recovered,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`Recovered aborted contract deployments: ${recovered.length}`);
console.log("Recovery evidence written to an ignored private JSON file");
