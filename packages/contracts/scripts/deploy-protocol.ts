import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

type MainnetPlan = Readonly<{
  protocol: "ZKBLAST";
  kind: "predeployment-plan";
  environment: "mainnet";
  chainId: 4663;
  deployerAddress: Address;
  startingNonce: number;
  governance: {
    safeAddress: Address;
    timelockAddress: Address;
    timelockDelaySeconds: string;
  };
  transactionCount: 9;
  contracts: Record<
    string,
    {
      implementation: Address;
      proxy: Address | null;
      creationBytecodeHash: Hex;
      runtimeBytecodeHash: Hex;
    }
  >;
  proxy: {
    creationBytecodeHash: Hex;
    runtimeBytecodeHash: Hex;
  };
}>;

type AuditApproval = Readonly<{
  protocol: "ZKBLAST";
  approved: boolean;
  unresolvedCritical: number;
  unresolvedHigh: number;
  auditors: readonly string[];
}>;

type OwnerRiskAcceptance = Readonly<{
  protocol: "ZKBLAST";
  environment: "mainnet";
  independentAuditCompleted: false;
  ownerAcceptsUnauditedMainnetRisk: true;
  deploymentPlanSha256: string;
  scope: readonly string[];
  excludedScope: readonly string[];
  shieldedCustodyMustRemainInactive: true;
  doesNotAuthorizeBroadcast: true;
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

async function readJson<T>(location: string): Promise<T> {
  return JSON.parse(await readFile(location, "utf8")) as T;
}

const environment = required("APP_ENV");
const checkOnly = process.argv.includes("--check-only");
const rehearsal = process.argv.includes("--rehearsal");
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be testnet or mainnet");
}
if (
  environment === "mainnet" &&
  !checkOnly &&
  !rehearsal &&
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
if (rehearsal) {
  const hostname = new URL(rpcUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("Mainnet rehearsal requires a loopback RPC URL");
  }
}
const explorerUrl = required("BLOCK_EXPLORER_URL");
const manifestRelativePath = required("DEPLOYMENT_MANIFEST_PATH");
const expectedPath = rehearsal
  ? "deployments/mainnet/rehearsal-manifest.json"
  : `deployments/${environment}/manifest.json`;
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
  `deployments/${environment}/${rehearsal ? "rehearsal" : "deployment"}-${Date.now()}.private.json`,
);

const actualChainId = await publicClient.getChainId();
if (actualChainId !== chainId)
  throw new Error(
    `RPC chain mismatch: expected ${chainId}, received ${actualChainId}`,
  );

const proxyArtifact = await artifact("ERC1967Proxy", "ERC1967Proxy");
const deployments: Record<string, unknown> = {};
const allTransactions: TransactionRecord[] = [];

async function assertMainnetReleaseGates(
  startingNonce: number,
  artifacts: Readonly<Record<string, Artifact>>,
): Promise<void> {
  if (environment !== "mainnet") return;
  const plan = await readJson<MainnetPlan>(
    path.resolve(repositoryRoot, "deployments/mainnet/deployment-plan.json"),
  );
  if (
    plan.protocol !== "ZKBLAST" ||
    plan.kind !== "predeployment-plan" ||
    plan.environment !== "mainnet" ||
    plan.chainId !== 4663 ||
    plan.transactionCount !== 9
  ) {
    throw new Error("Invalid mainnet deployment plan");
  }
  if (
    getAddress(plan.deployerAddress) !== account.address ||
    getAddress(plan.governance.safeAddress) !== governance ||
    getAddress(plan.governance.timelockAddress) !== upgrader ||
    plan.governance.timelockDelaySeconds !== "300"
  ) {
    throw new Error("Mainnet deployment plan authority mismatch");
  }
  if (plan.startingNonce !== startingNonce) {
    throw new Error(
      `Mainnet deployment plan nonce is stale: expected ${plan.startingNonce}, received ${startingNonce}`,
    );
  }
  const sequence = [
    ["PoolRegistry", 0, 1],
    ["PoolFactory", 2, 3],
    ["SwapRouter", 4, 5],
    ["PositionManager", 6, 7],
    ["PoolQuoter", 8, null],
  ] as const;
  for (const [name, implementationOffset, proxyOffset] of sequence) {
    const planned = plan.contracts[name];
    const value = artifacts[name];
    if (!planned || !value) throw new Error(`${name} missing from release plan`);
    const implementation = getContractAddress({
      from: account.address,
      nonce: BigInt(startingNonce + implementationOffset),
    });
    const proxy =
      proxyOffset === null
        ? null
        : getContractAddress({
            from: account.address,
            nonce: BigInt(startingNonce + proxyOffset),
          });
    if (planned.implementation !== implementation || planned.proxy !== proxy) {
      throw new Error(`${name} predicted address mismatch`);
    }
    if (
      planned.creationBytecodeHash !== keccak256(value.bytecode.object) ||
      planned.runtimeBytecodeHash !== keccak256(value.deployedBytecode.object)
    ) {
      throw new Error(`${name} artifact hash mismatch`);
    }
  }
  if (
    plan.proxy.creationBytecodeHash !== keccak256(proxyArtifact.bytecode.object) ||
    plan.proxy.runtimeBytecodeHash !==
      keccak256(proxyArtifact.deployedBytecode.object)
  ) {
    throw new Error("ERC1967Proxy artifact hash mismatch");
  }
  if (rehearsal) return;
  let audit: AuditApproval | undefined;
  try {
    audit = await readJson<AuditApproval>(
      path.resolve(repositoryRoot, "audit-artifacts/mainnet/approval.json"),
    );
  } catch {}
  const auditApproved = Boolean(
    audit &&
      audit.protocol === "ZKBLAST" &&
      audit.approved === true &&
      audit.unresolvedCritical === 0 &&
      audit.unresolvedHigh === 0 &&
      Array.isArray(audit.auditors) &&
      audit.auditors.length > 0,
  );
  let waiver: OwnerRiskAcceptance | undefined;
  try {
    waiver = await readJson<OwnerRiskAcceptance>(
      path.resolve(
        repositoryRoot,
        "audit-artifacts/mainnet/owner-risk-acceptance.json",
      ),
    );
  } catch {}
  const requiredCoreScope = [
    "PoolRegistry",
    "PoolFactory",
    "SwapRouter",
    "PositionManager",
    "PoolQuoter",
  ];
  const planBytes = await readFile(
    path.resolve(repositoryRoot, "deployments/mainnet/deployment-plan.json"),
  );
  const planHash = createHash("sha256").update(planBytes).digest("hex");
  const waiverAccepted = Boolean(
    waiver &&
      waiver.protocol === "ZKBLAST" &&
      waiver.environment === "mainnet" &&
      waiver.independentAuditCompleted === false &&
      waiver.ownerAcceptsUnauditedMainnetRisk === true &&
      waiver.deploymentPlanSha256 === planHash &&
      waiver.shieldedCustodyMustRemainInactive === true &&
      waiver.doesNotAuthorizeBroadcast === true &&
      requiredCoreScope.every((name) => waiver?.scope.includes(name)),
  );
  if (!auditApproved && !waiverAccepted) {
    throw new Error(
      "Independent audit approval or explicit scoped owner risk acceptance is required",
    );
  }
}

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
const releaseArtifacts = {
  PoolRegistry: await artifact("PoolRegistry", "PoolRegistry"),
  PoolFactory: await artifact("PoolFactory", "PoolFactory"),
  SwapRouter: await artifact("SwapRouter", "SwapRouter"),
  PositionManager: await artifact("PositionManager", "PositionManager"),
  PoolQuoter: await artifact("PoolQuoter", "PoolQuoter"),
};
await assertMainnetReleaseGates(startingNonce, releaseArtifacts);
if (checkOnly) {
  console.log(`Mainnet release gates passed at nonce ${startingNonce}`);
  process.exit(0);
}
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
