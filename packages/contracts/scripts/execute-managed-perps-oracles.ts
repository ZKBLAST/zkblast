import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, getAddress, http,
  parseEther, type Abi, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert.equal(capArg, "0.000123", "Unapproved fee cap");
const cap = parseEther(capArg);
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(key && /^0x[0-9a-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY is invalid");
const deployer = privateKeyToAccount(key as Hex);
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
const planPath = path.join(root, "deployments/mainnet/perps-managed-oracles-plan.json");
const plan = JSON.parse(await readFile(planPath, "utf8")) as any;
assert.equal(plan.chainId, manifest.chainId, "Plan chain mismatch");
assert.equal(plan.deployments.length, 3, "Expected three feed deployments");
assert.equal(plan.configurations.length, 3, "Expected three feed configurations");
assert(BigInt(plan.gas.feeCeilingWei) <= cap, "Refreshed plan exceeds approved cap");
assert.equal(deployer.address, getAddress(plan.deployer), "Deployer key mismatch");

const artifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/BoundedManagedPriceFeed.sol/BoundedManagedPriceFeed.json"), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const oracleArtifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/ChainlinkOracleAdapter.sol/ChainlinkOracleAdapter.json"), "utf8")) as { abi: Abi };
const registryArtifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/PerpMarketRegistry.sol/PerpMarketRegistry.json"), "utf8")) as { abi: Abi };
const chain = defineChain({ id: manifest.chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL] } } });
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: deployer, chain, transport });
assert.equal(await publicClient.getChainId(), manifest.chainId, "RPC chain mismatch");
const receipts: TransactionReceipt[] = [];
let spent = 0n;
const record = async (hash: Hex, label: string) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `${label} failed`);
  spent += receipt.gasUsed * receipt.effectiveGasPrice;
  assert(spent <= cap, `Actual fee exceeded cap after ${label}`);
  receipts.push(receipt);
  return receipt;
};
const feeGuard = async (gas: bigint, label: string) => {
  const gasPrice = await publicClient.getGasPrice();
  assert(spent + gas * gasPrice * 2n <= cap, `Fee guard stopped before ${label}`);
};

for (const deployment of plan.deployments) {
  const args = deployment.args;
  const contractArgs = [
    getAddress(args[0]), getAddress(args[1]), String(args[2]), BigInt(args[3]),
    BigInt(args[4]), Number(args[5]), Number(args[6]),
  ] as const;
  const deploymentData = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: contractArgs });
  const gas = await publicClient.estimateGas({ account: deployer, data: deploymentData });
  await feeGuard(gas, `deploy-${deployment.symbol}`);
  const receipt = await record(await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: contractArgs }), `deploy-${deployment.symbol}`);
  assert(receipt.contractAddress, `${deployment.symbol} missing contract address`);
  assert.equal(getAddress(receipt.contractAddress), getAddress(deployment.address), `${deployment.symbol} predicted address mismatch`);
}

for (const action of plan.configurations) {
  const operation = await prepareSafeOperation(publicClient, {
    chainId: manifest.chainId, safe: getAddress(plan.governance), to: getAddress(action.target), data: action.data, relayer: deployer,
  });
  const gas = await publicClient.estimateGas({ account: deployer, to: operation.to, data: operation.data });
  await feeGuard(gas, `configure-${action.symbol}`);
  await record(await wallet.sendTransaction({ account: deployer, to: operation.to, data: operation.data }), `configure-${action.symbol}`);
}

const allMarkets = JSON.parse(await readFile(path.join(root, "deployments/mainnet/perps-all-markets-plan.json"), "utf8")) as any;
for (const deployment of plan.deployments) {
  const market = allMarkets.markets.find((candidate: any) => candidate.symbol === `${deployment.symbol}-PERP`);
  assert(market, `${deployment.symbol} market missing`);
  const [code, price, paused, config] = await Promise.all([
    publicClient.getCode({ address: getAddress(deployment.address) }),
    publicClient.readContract({ address: manifest.perps.oracle, abi: oracleArtifact.abi, functionName: "latestPrice", args: [market.oracleId] }),
    publicClient.readContract({ address: manifest.perps.registry, abi: registryArtifact.abi, functionName: "isPaused", args: [market.marketId] }),
    publicClient.readContract({ address: manifest.perps.registry, abi: registryArtifact.abi, functionName: "market", args: [market.marketId] }) as Promise<any>,
  ]);
  assert(code && code !== "0x", `${deployment.symbol} feed runtime missing`);
  assert((price as any).value > 0n, `${deployment.symbol} adapter price invalid`);
  assert(paused && !config.enabled, `${deployment.symbol} market safety state mismatch`);
}
const evidence = {
  schemaVersion: 1, chainId: manifest.chainId, status: "confirmed",
  transactions: receipts.map((receipt, index) => ({
    step: index < 3 ? `deploy-${plan.deployments[index].symbol}` : `configure-${plan.configurations[index - 3].symbol}`,
    hash: receipt.transactionHash, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
  })),
  feeds: Object.fromEntries(plan.deployments.map((deployment: any) => [deployment.symbol, deployment.address])),
  totalFeeWei: spent.toString(), totalFeeEth: formatEther(spent), approvedCapEth: formatEther(cap),
  postState: "NFLX, PONS and ZKBLAST feeds configured; all three markets disabled and paused",
};
const evidencePath = path.join(root, "deployments/mainnet/perps-managed-oracles-execution.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ transactions: evidence.transactions, feeds: evidence.feeds, totalFeeEth: evidence.totalFeeEth, approvedCapEth: evidence.approvedCapEth, evidencePath }));
