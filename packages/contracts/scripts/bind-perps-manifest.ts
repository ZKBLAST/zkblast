import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
assert(process.env.PERPS_RELAYER_ADDRESS, "PERPS_RELAYER_ADDRESS is required");
assert(/^\d+$/u.test(process.env.PERPS_RELAYER_FEE_RAW ?? ""), "PERPS_RELAYER_FEE_RAW must be an integer");
assert(/^0x[0-9a-f]{64}$/iu.test(process.env.PERPS_RELAYER_PRIVATE_KEY ?? ""), "PERPS_RELAYER_PRIVATE_KEY is invalid");
assert.equal(
  privateKeyToAccount(process.env.PERPS_RELAYER_PRIVATE_KEY as Hex).address.toLowerCase(),
  getAddress(process.env.PERPS_RELAYER_ADDRESS).toLowerCase(),
  "PERPS_RELAYER_ADDRESS does not match PERPS_RELAYER_PRIVATE_KEY",
);

const manifestPath = path.join(root, `deployments/${environment}/manifest.json`);
const planPath = path.join(root, `deployments/${environment}/perps-v1-plan.json`);
const journalPath = path.join(root, `deployments/${environment}/perps-v1-broadcast.private.json`);
const releasePath = path.join(root, `apps/web/public/zk/${environment}/perps-v1/manifest.json`);
const [manifestBytes, planBytes, journalBytes, releaseBytes] = await Promise.all([
  readFile(manifestPath), readFile(planPath), readFile(journalPath), readFile(releasePath),
]);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as any;
const plan = JSON.parse(planBytes.toString("utf8")) as any;
const journal = JSON.parse(journalBytes.toString("utf8")) as any;
const release = JSON.parse(releaseBytes.toString("utf8")) as any;
const relayerAddress = getAddress(process.env.PERPS_RELAYER_ADDRESS);
const privilegedAddresses = [
  manifest.deployerAddress,
  manifest.governanceAddress,
  manifest.upgraderAddress,
  manifest.roles?.defaultAdmin,
  manifest.roles?.upgrader,
].filter(Boolean).map((value: string) => value.toLowerCase());
assert(!privilegedAddresses.includes(relayerAddress.toLowerCase()), "Perps relayer must be separate from deployer and governance roles");
const updateRelayerOnly = process.argv.includes("--update-relayer");
assert(!manifest.perps || updateRelayerOnly, "Manifest already contains Perps; use --update-relayer for an explicit relayer-only change");
assert(plan.environment === environment && manifest.chainId === plan.chainId, "Perps plan scope mismatch");
assert(release.environment === environment && Number(release.chainId) === plan.chainId, "Perps release scope mismatch");
assert(release.adapter.toLowerCase() === plan.addresses.ShieldedPerpAdapterProxy.toLowerCase(), "Perps release adapter mismatch");
assert(journal.transactions.length === 22 && journal.transactions.every((tx: any) => tx.state === "confirmed"), "Perps broadcast journal is incomplete");

const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), plan.chainId, "RPC chain mismatch");
const firstReceipt = await client.getTransactionReceipt({ hash: journal.transactions[0].hash as Hex });
const releaseHash = createHash("sha256").update(releaseBytes).digest("hex");
const totalGas = journal.transactions.reduce((sum: bigint, tx: any) => sum + BigInt(tx.gasUsed), 0n);
const totalFee = journal.transactions.reduce((sum: bigint, tx: any) => sum + BigInt(tx.feeWei), 0n);
const address = (name: string): Address => getAddress(plan.addresses[name]);

const perps = {
  registry: address("PerpMarketRegistryProxy"),
  oracle: address("ChainlinkOracleAdapterProxy"),
  funding: address("FundingRateModuleProxy"),
  engine: address("PerpEngineProxy"),
  insuranceFund: address("InsuranceFundProxy"),
  liquidityVault: address("LiquidityVaultUSDGProxy"),
  shieldedAdapter: address("ShieldedPerpAdapterProxy"),
  collateral: getAddress(plan.dependencies.collateral),
  deploymentBlock: Number(firstReceipt.blockNumber),
  proverRelease: {
    manifestPath: `/zk/${environment}/perps-v1/manifest.json`,
    manifestSha256: releaseHash,
  },
  relayer: {
    address: relayerAddress,
    feeRaw: process.env.PERPS_RELAYER_FEE_RAW,
  },
};
if (updateRelayerOnly) {
  assert(manifest.perps, "Cannot update a relayer before Perps is bound");
  const { relayer: _oldRelayer, ...currentDeployment } = manifest.perps;
  const { relayer: _newRelayer, ...plannedDeployment } = perps;
  assert.deepEqual(currentDeployment, plannedDeployment, "Existing Perps deployment differs from the verified plan");
}
manifest.perps = perps;
manifest.generatedAt = new Date().toISOString();
if (!updateRelayerOnly) {
  manifest.totals = {
    transactionCount: manifest.totals.transactionCount + 22,
    gasUsed: (BigInt(manifest.totals.gasUsed) + totalGas).toString(),
    totalFeeWei: (BigInt(manifest.totals.totalFeeWei) + totalFee).toString(),
  };
}

if (!process.argv.includes("--write")) {
  console.log(JSON.stringify({ environment, perps: manifest.perps, addedGas: totalGas.toString(), addedFeeWei: totalFee.toString() }));
  process.exit(0);
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ environment, manifestPath, perps: manifest.perps }));
