import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, encodeDeployData, encodeFunctionData, formatEther, getAddress,
  getContractAddress, http, keccak256, type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV must be mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8")) as any;
const allMarkets = JSON.parse(await readFile(path.join(root, "deployments/mainnet/perps-all-markets-plan.json"), "utf8")) as any;
const artifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/BoundedManagedPriceFeed.sol/BoundedManagedPriceFeed.json"), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
const oracleArtifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/ChainlinkOracleAdapter.sol/ChainlinkOracleAdapter.json"), "utf8")) as { abi: Abi };
const key = process.env.DEPLOYER_PRIVATE_KEY;
assert(key && /^0x[0-9a-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY is invalid");
const deployer = privateKeyToAccount(key as Hex);
assert.equal(deployer.address, getAddress(manifest.deployerAddress), "Deployer key mismatch");
const reporter = getAddress(manifest.perps.relayer.address);
const governance = getAddress(manifest.roles.defaultAdmin);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");
const [nonce, block, gasPrice] = await Promise.all([
  client.getTransactionCount({ address: deployer.address, blockTag: "pending" }), client.getBlock(), client.getGasPrice(),
]);

const inputs = [
  { symbol: "NFLX", answer: 6_261_000_000n, maximumDeviationBps: 500, maximumObservationDelay: 900 },
  { symbol: "PONS", answer: 23_703_797n, maximumDeviationBps: 1000, maximumObservationDelay: 900 },
  { symbol: "ZKBLAST", answer: 1_001_700n, maximumDeviationBps: 1000, maximumObservationDelay: 300 },
] as const;
const deployments = [];
const configurations = [];
let deploymentGas = 0n;
for (const [index, input] of inputs.entries()) {
  const market = allMarkets.markets.find((candidate: any) => candidate.symbol === `${input.symbol}-PERP`);
  assert(market && market.oracle.status === "oracle_required", `${input.symbol} is not oracle-gated`);
  const args = [
    governance, reporter, `${input.symbol} / USD (ZKBLAST managed alpha)`, input.answer,
    block.timestamp, input.maximumDeviationBps, input.maximumObservationDelay,
  ] as const;
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const address = getContractAddress({ from: deployer.address, nonce: BigInt(nonce + index) });
  const gas = await client.estimateGas({ account: deployer.address, data });
  deploymentGas += gas;
  deployments.push({ symbol: input.symbol, address, nonce: nonce + index, args, dataHash: keccak256(data), estimatedGas: gas.toString() });
  const configureData = encodeFunctionData({
    abi: oracleArtifact.abi, functionName: "configureFeed",
    args: [market.oracleId, address, input.maximumObservationDelay, true],
  });
  configurations.push({ symbol: input.symbol, target: getAddress(manifest.perps.oracle), data: configureData, calldataHash: keccak256(configureData), estimatedTargetGas: "80000" });
}
const configurationGas = configurations.reduce((sum, action) => sum + BigInt(action.estimatedTargetGas), 0n);
const safeOverhead = 250_000n * BigInt(configurations.length);
const modeledGas = deploymentGas + configurationGas + safeOverhead;
const feeCeiling = modeledGas * gasPrice * 2n;
const output = path.join(root, "deployments/mainnet/perps-managed-oracles-plan.json");
await writeFile(output, `${JSON.stringify({
  schemaVersion: 1, chainId: manifest.chainId, observedBlock: block.number.toString(), deployer: deployer.address,
  governance, reporter, trustModel: "single ZKBLAST reporter with onchain freshness and deviation bounds",
  deployments, configurations,
  sources: {
    NFLX: "external market reference; 5% per-update bound; 15-minute maximum age",
    PONS: "PONS/WETH reference converted by Chainlink ETH/USD; 10% per-update bound; 15-minute maximum age",
    ZKBLAST: "ZKBLAST/USDG reference; 10% per-update bound; 5-minute maximum age",
  },
  gas: { observedPriceWei: gasPrice.toString(), deploymentEstimate: deploymentGas.toString(), configurationEstimate: configurationGas.toString(), safeOverhead: safeOverhead.toString(), modeledTotal: modeledGas.toString(), feeCeilingWei: feeCeiling.toString(), feeCeilingEth: formatEther(feeCeiling) },
  invariants: ["markets remain disabled and paused", "engine openings and vault positions remain paused", "no USDG movement", "reporter cannot bypass freshness or deviation limits"],
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`);
console.log(JSON.stringify({ deployments: deployments.map(({ symbol, address }) => ({ symbol, address })), actionCount: 6, feeCeilingEth: formatEther(feeCeiling), output }));
