import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: {
    compiler?: { version?: string };
    settings?: { optimizer?: { enabled?: boolean; runs?: number } };
  };
}>;

type TransactionRecord = Readonly<{
  hash: Hash;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hash;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
}>;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const artifactRoot = path.resolve(scriptDirectory, "../out");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(): Hex {
  const value = required("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[\da-f]{64}$/iu.test(value))
    throw new Error("DEPLOYER_PRIVATE_KEY is invalid");
  return value as Hex;
}

async function artifact(source: string, contract: string): Promise<Artifact> {
  const location = path.join(artifactRoot, `${source}.sol`, `${contract}.json`);
  return JSON.parse(await readFile(location, "utf8")) as Artifact;
}

const environment = required("APP_ENV");
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be testnet or mainnet");
}
if (
  environment === "mainnet" &&
  process.env.CONFIRM_MAINNET_DEPLOYMENT !== "DEPLOY_ZKBLAST_MAINNET"
) {
  throw new Error(
    "Mainnet deployment requires CONFIRM_MAINNET_DEPLOYMENT=DEPLOY_ZKBLAST_MAINNET",
  );
}
const chainId = Number(required("CHAIN_ID"));
if (!Number.isSafeInteger(chainId) || chainId <= 0)
  throw new Error("CHAIN_ID is invalid");
const chainName = required("CHAIN_NAME");
const rpcUrl = required("RPC_URL");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const manifestRelativePath = required("DEPLOYMENT_MANIFEST_PATH");
const expectedPath = `deployments/${environment}/manifest.json`;
if (manifestRelativePath !== expectedPath)
  throw new Error(`DEPLOYMENT_MANIFEST_PATH must be ${expectedPath}`);

const governance = getAddress(required("GOVERNANCE_MULTISIG_ADDRESS"));
const upgrader = getAddress(required("PROXY_ADMIN_ADDRESS"));
const account = privateKeyToAccount(privateKey());
const chain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: `${chainName} Explorer`, url: explorerUrl },
  },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});
const journalPath = path.resolve(
  repositoryRoot,
  `deployments/${environment}/deployment-${Date.now()}.private.json`,
);

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId)
  throw new Error(
    `RPC chain mismatch: expected ${chainId}, received ${actualChainId}`,
  );

const proxyArtifact = await artifact("ERC1967Proxy", "ERC1967Proxy");
const deployments: Record<string, unknown> = {};
const allTransactions: TransactionRecord[] = [];

async function receipt(hash: Hash): Promise<TransactionRecord> {
  const value = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  if (value.status !== "success")
    throw new Error(`Transaction reverted: ${hash}`);
  const record = transactionRecord(value);
  allTransactions.push(record);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(
    journalPath,
    `${JSON.stringify(
      {
        protocol: "ZKBLAST",
        environment,
        chainId,
        deployerAddress: account.address,
        updatedAt: new Date().toISOString(),
        transactions: allTransactions,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return record;
}

function transactionRecord(value: TransactionReceipt): TransactionRecord {
  const gasPrice = value.effectiveGasPrice;
  return {
    hash: value.transactionHash,
    contractAddress: value.contractAddress
      ? getAddress(value.contractAddress)
      : null,
    blockNumber: Number(value.blockNumber),
    blockHash: value.blockHash,
    gasUsed: value.gasUsed.toString(),
    effectiveGasPriceWei: gasPrice.toString(),
    totalFeeWei: (value.gasUsed * gasPrice).toString(),
    status: "success",
  };
}

async function deployRaw(
  abi: Abi,
  bytecode: Hex,
  args: readonly unknown[] = [],
) {
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
    account,
  });
  const transaction = await receipt(hash);
  const value = await publicClient.getTransactionReceipt({ hash });
  if (!value.contractAddress)
    throw new Error(`Missing contract address for ${hash}`);
  return { address: getAddress(value.contractAddress), transaction };
}

async function deployUpgradeable(
  name: string,
  source: string,
  initializeArgs: readonly unknown[],
) {
  const implementationArtifact = await artifact(source, name);
  const implementation = await deployRaw(
    implementationArtifact.abi,
    implementationArtifact.bytecode.object,
  );
  const initializerData = encodeFunctionData({
    abi: implementationArtifact.abi,
    functionName: "initialize",
    args: initializeArgs,
  });
  const proxy = await deployRaw(
    proxyArtifact.abi,
    proxyArtifact.bytecode.object,
    [implementation.address, initializerData],
  );
  const deployedCode = await publicClient.getBytecode({
    address: implementation.address,
  });
  if (!deployedCode)
    throw new Error(`Missing implementation bytecode for ${name}`);
  deployments[name] = {
    contractName: name,
    proxyKind: "uups",
    proxyAddress: proxy.address,
    implementationAddress: implementation.address,
    deployerAddress: account.address,
    governanceAddress: governance,
    upgraderAddress: upgrader,
    artifactBytecodeHash: keccak256(
      implementationArtifact.deployedBytecode.object,
    ),
    deployedRuntimeBytecodeHash: keccak256(deployedCode),
    initializerCalldataHash: keccak256(initializerData),
    initializerArguments: initializeArgs,
    transactions: {
      implementationDeployment: implementation.transaction,
      proxyDeploymentAndInitialization: proxy.transaction,
      configuration: [],
    },
    upgrades: [],
    compiler: compilerRecord(implementationArtifact),
    verification: { implementation: "pending", proxy: "pending", urls: [] },
  };
  return proxy.address;
}

function compilerRecord(value: Artifact) {
  return {
    version: value.metadata.compiler?.version ?? "0.8.26",
    optimizer: value.metadata.settings?.optimizer?.enabled ?? true,
    optimizerRuns: value.metadata.settings?.optimizer?.runs ?? 200,
  };
}

const startingNonce = await publicClient.getTransactionCount({
  address: account.address,
  blockTag: "pending",
});
const predictedFactoryAddress = getContractAddress({
  from: account.address,
  nonce: BigInt(startingNonce + 3),
});
const registryAddress = await deployUpgradeable(
  "PoolRegistry",
  "PoolRegistry",
  [governance, upgrader, predictedFactoryAddress],
);
const factoryAddress = await deployUpgradeable("PoolFactory", "PoolFactory", [
  governance,
  upgrader,
  registryAddress,
]);
if (factoryAddress !== predictedFactoryAddress) {
  throw new Error(
    `Factory address mismatch: predicted ${predictedFactoryAddress}, deployed ${factoryAddress}`,
  );
}
const routerAddress = await deployUpgradeable("SwapRouter", "SwapRouter", [
  governance,
  upgrader,
  registryAddress,
]);
const positionManagerAddress = await deployUpgradeable(
  "PositionManager",
  "PositionManager",
  [governance, upgrader, registryAddress],
);

const quoterArtifact = await artifact("PoolQuoter", "PoolQuoter");
const quoter = await deployRaw(
  quoterArtifact.abi,
  quoterArtifact.bytecode.object,
);
const quoterCode = await publicClient.getBytecode({ address: quoter.address });
if (!quoterCode) throw new Error("Missing PoolQuoter bytecode");
deployments.PoolQuoter = {
  contractName: "PoolQuoter",
  proxyKind: "none",
  proxyAddress: null,
  implementationAddress: quoter.address,
  deployerAddress: account.address,
  governanceAddress: null,
  upgraderAddress: null,
  artifactBytecodeHash: keccak256(quoterArtifact.deployedBytecode.object),
  deployedRuntimeBytecodeHash: keccak256(quoterCode),
  initializerCalldataHash: null,
  initializerArguments: [],
  transactions: {
    implementationDeployment: quoter.transaction,
    proxyDeploymentAndInitialization: null,
    configuration: [],
  },
  upgrades: [],
  compiler: compilerRecord(quoterArtifact),
  verification: {
    implementation: "pending",
    proxy: "not_applicable",
    urls: [],
  },
};

const latestBlock = await publicClient.getBlock();
const manifest = {
  schemaVersion: 2,
  protocol: "ZKBLAST",
  environment,
  chainId,
  chainName,
  generatedAt: new Date().toISOString(),
  deploymentBlock: Number(latestBlock.number),
  deploymentBlockHash: latestBlock.hash,
  deployerAddress: account.address,
  governanceAddress: governance,
  upgraderAddress: upgrader,
  contracts: deployments,
  roles: {
    defaultAdmin: governance,
    upgrader,
    factory: factoryAddress,
  },
  totals: {
    transactionCount: allTransactions.length,
    gasUsed: allTransactions
      .reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)
      .toString(),
    totalFeeWei: allTransactions
      .reduce((sum, item) => sum + BigInt(item.totalFeeWei), 0n)
      .toString(),
  },
  integration: {
    poolRegistry: registryAddress,
    poolFactory: factoryAddress,
    swapRouter: routerAddress,
    positionManager: positionManagerAddress,
    poolQuoter: quoter.address,
  },
};

const manifestPath = path.resolve(repositoryRoot, manifestRelativePath);
await mkdir(path.dirname(manifestPath), { recursive: true });
const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
await rename(temporaryPath, manifestPath);
console.log(`Deployment complete: ${environment} chain ${chainId}`);
console.log(`Manifest written: ${manifestRelativePath}`);
console.log(`Transactions: ${allTransactions.length}`);
