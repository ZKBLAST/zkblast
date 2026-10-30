import assert from "node:assert/strict";
import path from "node:path";
import { createPublicClient, formatEther, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadDeploymentManifestFile } from "@zkblast/config/node";

const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
assert(/^0x[0-9a-f]{64}$/iu.test(process.env.PERPS_RELAYER_PRIVATE_KEY ?? ""), "PERPS_RELAYER_PRIVATE_KEY is invalid");
assert(/^\d+$/u.test(process.env.PERPS_RELAYER_MAX_GAS ?? ""), "PERPS_RELAYER_MAX_GAS is invalid");

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = await loadDeploymentManifestFile(
  path.join(root, `deployments/${environment}/manifest.json`),
  { environment, chainId: environment === "mainnet" ? 4663 : 46630 },
);
assert(manifest.perps, "Perps manifest is not bound");
const account = privateKeyToAccount(process.env.PERPS_RELAYER_PRIVATE_KEY as Hex);
assert.equal(account.address, getAddress(manifest.perps.relayer.address), "Relayer account does not match manifest");

const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), manifest.chainId, "Relayer RPC chain mismatch");
const [balance, gasPrice, nonce] = await Promise.all([
  client.getBalance({ address: account.address }),
  client.getGasPrice(),
  client.getTransactionCount({ address: account.address, blockTag: "pending" }),
]);
const maximumGas = BigInt(process.env.PERPS_RELAYER_MAX_GAS!);
const jobs = 5n;
const recommendedReserve = maximumGas * gasPrice * jobs * 125n / 100n;

console.log(JSON.stringify({
  environment,
  chainId: manifest.chainId,
  relayer: account.address,
  nonce,
  balanceWei: balance.toString(),
  balanceEth: formatEther(balance),
  gasPriceWei: gasPrice.toString(),
  maximumGasPerJob: maximumGas.toString(),
  recommendedJobs: jobs.toString(),
  recommendedReserveWei: recommendedReserve.toString(),
  recommendedReserveEth: formatEther(recommendedReserve),
  shortfallWei: (balance >= recommendedReserve ? 0n : recommendedReserve - balance).toString(),
  funded: balance >= recommendedReserve,
}));
