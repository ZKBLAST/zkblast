import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, type Address, type Hex } from "viem";
import { parseDeploymentManifest } from "../../config/src/deployment.js";

type JournalTx = { nonce: number; name: string; hash: Hex; blockNumber: string; gasUsed: string; effectiveGasPrice: string; contractAddress?: Address | null };
type Artifact = { bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const read = async <T>(name: string) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as T;
const core = await read<{ deployer: Address; governance: Address; upgrader: Address; contracts: Record<string, Address>; transactions: JournalTx[] }>("core-manifest.json");
const corePlan = await read<{ initializerHashes: Record<string, Hex> }>("core-deployment-plan.json");
const dbc = await read<{ contracts: Record<string, Address> }>("dbc-manifest.json");
const launchpad = await read<{ addresses: Record<string, Address> }>("launchpad-manifest.json");
const adapter = await read<{ addresses: { registry: Address } }>("adapter-registry-manifest.json");
const dbcJournal = await read<{ transactions: JournalTx[] }>("dbc-broadcast.private.json");
const launchpadJournal = await read<{ transactions: JournalTx[] }>("launchpad-broadcast.private.json");
const adapterJournal = await read<{ transactions: JournalTx[] }>("adapter-registry-broadcast.private.json");
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm", { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== 999) throw new Error("HYPEREVM_RUNTIME_MANIFEST_CHAIN_INVALID");

const allTransactions = [...core.transactions, ...dbcJournal.transactions, ...launchpadJournal.transactions, ...adapterJournal.transactions];
if (allTransactions.length !== 57 || allTransactions.some((tx, index) => tx.nonce !== index)) throw new Error("HYPEREVM_RUNTIME_MANIFEST_NONCE_INVALID");
const receiptByHash = new Map<Hex, Awaited<ReturnType<typeof client.getTransactionReceipt>>>();
for (const tx of core.transactions) receiptByHash.set(tx.hash, await client.getTransactionReceipt({ hash: tx.hash }));
const publicTransaction = (tx: JournalTx) => {
  const receipt = receiptByHash.get(tx.hash);
  if (!receipt || receipt.status !== "success") throw new Error(`HYPEREVM_RUNTIME_RECEIPT_INVALID:${tx.nonce}`);
  const totalFee = BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice);
  return { hash: tx.hash, contractAddress: tx.contractAddress ? getAddress(tx.contractAddress) : null, blockNumber: Number(tx.blockNumber), blockHash: receipt.blockHash, gasUsed: tx.gasUsed, effectiveGasPriceWei: tx.effectiveGasPrice, totalFeeWei: totalFee.toString(), status: "success" as const };
};
const loadArtifact = async (name: string): Promise<Artifact> => JSON.parse(await readFile(path.join(root, `packages/contracts/out-hyperevm/${name}.sol/${name}.json`), "utf8")) as Artifact;
const definitions = [
  { key: "PoolRegistry", artifact: "PoolRegistry", implementation: "poolRegistryImplementation", proxy: "poolRegistry", implementationNonce: 1, proxyNonce: 2, initializer: "poolRegistry" },
  { key: "PoolFactory", artifact: "HyperEvmDammPoolFactory", implementation: "poolFactoryImplementation", proxy: "poolFactory", implementationNonce: 3, proxyNonce: 4, initializer: "poolFactory" },
  { key: "SwapRouter", artifact: "SwapRouter", implementation: "swapRouterImplementation", proxy: "swapRouter", implementationNonce: 5, proxyNonce: 6, initializer: "swapRouter" },
  { key: "PositionManager", artifact: "PositionManager", implementation: "positionManagerImplementation", proxy: "positionManager", implementationNonce: 7, proxyNonce: 8, initializer: "positionManager" },
  { key: "PoolQuoter", artifact: "PoolQuoter", implementation: "poolQuoter", implementationNonce: 9 },
] as const;
const contracts: Record<string, unknown> = {};
for (const definition of definitions) {
  const artifact = await loadArtifact(definition.artifact);
  const implementationTx = core.transactions.find((tx) => tx.nonce === definition.implementationNonce)!;
  const proxyTx = "proxyNonce" in definition ? core.transactions.find((tx) => tx.nonce === definition.proxyNonce)! : null;
  const proxyAddress = "proxy" in definition ? getAddress(core.contracts[definition.proxy]!) : null;
  contracts[definition.key] = { contractName: definition.artifact, proxyKind: proxyAddress ? "uups" : "none", proxyAddress, implementationAddress: getAddress(core.contracts[definition.implementation]!), deployerAddress: getAddress(core.deployer), governanceAddress: proxyAddress ? getAddress(core.governance) : null, upgraderAddress: proxyAddress ? getAddress(core.upgrader) : null, artifactBytecodeHash: keccak256(artifact.bytecode.object), deployedRuntimeBytecodeHash: keccak256(artifact.deployedBytecode.object), initializerCalldataHash: "initializer" in definition ? corePlan.initializerHashes[definition.initializer]! : null, initializerArguments: [], transactions: { implementationDeployment: publicTransaction(implementationTx), proxyDeploymentAndInitialization: proxyTx ? publicTransaction(proxyTx) : null, configuration: [] }, upgrades: [], compiler: { version: "0.8.26", optimizer: true, optimizerRuns: 1 }, verification: { implementation: "pending", proxy: proxyAddress ? "pending" : "not_applicable", urls: [] } };
}
const deploymentReceipt = receiptByHash.get(core.transactions[0]!.hash)!;
const totalGas = allTransactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n);
const totalFee = allTransactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
const manifest = parseDeploymentManifest({ schemaVersion: 2, protocol: "ZKBLAST", environment: "mainnet", chainId: 999, chainName: "HyperEVM", generatedAt: new Date().toISOString(), deploymentBlock: Number(core.transactions[0]!.blockNumber), deploymentBlockHash: deploymentReceipt.blockHash, deployerAddress: getAddress(core.deployer), governanceAddress: getAddress(core.governance), upgraderAddress: getAddress(core.upgrader), contracts, roles: { defaultAdmin: getAddress(core.governance), upgrader: getAddress(core.upgrader), factory: getAddress(core.contracts.poolFactory!) }, totals: { transactionCount: allTransactions.length, gasUsed: totalGas.toString(), totalFeeWei: totalFee.toString() }, integration: { poolRegistry: getAddress(core.contracts.poolRegistry!), poolFactory: getAddress(core.contracts.poolFactory!), swapRouter: getAddress(core.contracts.swapRouter!), positionManager: getAddress(core.contracts.positionManager!), poolQuoter: getAddress(core.contracts.poolQuoter!) }, dbc: { abiVersion: 1, deploymentBlock: Number(dbcJournal.transactions[0]!.blockNumber), configRegistry: getAddress(dbc.contracts.configRegistry!), launchTokenDeployer: getAddress(dbc.contracts.launchTokenDeployer!), virtualPoolDeployer: getAddress(dbc.contracts.virtualPoolDeployer!), launchFactory: getAddress(dbc.contracts.launchFactory!), curveQuoter: getAddress(dbc.contracts.curveQuoter!), launchpadRouter: getAddress(dbc.contracts.launchpadRouter!), graduationManager: getAddress(dbc.contracts.graduationManager!), dammGraduationAdapter: getAddress(dbc.contracts.dammGraduationAdapter!), graduationAdapterRegistry: getAddress(adapter.addresses.registry), lpAllocationEscrow: getAddress(dbc.contracts.lpAllocationEscrow!) }, launchpad: { abiVersion: 1, deploymentBlock: Number(launchpadJournal.transactions[0]!.blockNumber), registry: getAddress(launchpad.addresses.registry!), configManager: getAddress(launchpad.addresses.configManager!), factory: getAddress(launchpad.addresses.factory!), lens: getAddress(launchpad.addresses.lens!), feeController: getAddress(launchpad.addresses.feeController!), revenueSplitter: getAddress(launchpad.addresses.revenueSplitter!), feeCollector: getAddress(launchpad.addresses.feeCollector!), tokenFactory: getAddress(launchpad.addresses.tokenFactory!) } }, { environment: "mainnet", chainId: 999 });
await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ chainId: manifest.chainId, transactionCount: manifest.totals.transactionCount, contractCount: Object.keys(manifest.contracts).length, dbc: Boolean(manifest.dbc), launchpad: Boolean(manifest.launchpad), path: "deployments/hyperevm-mainnet/manifest.json" }, null, 2));
