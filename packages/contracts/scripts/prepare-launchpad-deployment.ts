import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const artifactRoot = path.join(root, "packages/contracts/out");
const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("LAUNCHPAD_ENV_INVALID");
}
const expectedChainId = environment === "mainnet" ? 4663 : 46630;
if (Number(process.env.CHAIN_ID) !== expectedChainId || !process.env.RPC_URL) {
  throw new Error("LAUNCHPAD_NETWORK_CONFIG_INVALID");
}
const manifest = JSON.parse(
  await readFile(
    path.join(root, `deployments/${environment}/manifest.json`),
    "utf8",
  ),
) as {
  chainId: number;
  deployerAddress: Address;
  governanceAddress: Address;
  upgraderAddress: Address;
  dbc?: { configRegistry: Address; launchFactory: Address };
  shielded?: { assets?: { address: Address; symbol: string; decimals: number }[] };
};
if (manifest.chainId !== expectedChainId || !manifest.dbc) {
  throw new Error("LAUNCHPAD_MANIFEST_CONTEXT_INVALID");
}
const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
if ((await client.getChainId()) !== expectedChainId) {
  throw new Error("LAUNCHPAD_RPC_CHAIN_MISMATCH");
}
const [dbcRegistryCode, dbcFactoryCode] = await Promise.all([
  client.getCode({ address: getAddress(manifest.dbc.configRegistry) }),
  client.getCode({ address: getAddress(manifest.dbc.launchFactory) }),
]);
if (!dbcRegistryCode || !dbcFactoryCode) {
  throw new Error("LAUNCHPAD_DBC_DEPENDENCY_MISSING");
}
const usdgAsset = manifest.shielded?.assets?.find((asset) => asset.symbol === "USDG");
if (!usdgAsset) throw new Error("LAUNCHPAD_USDG_MANIFEST_MISSING");
const usdg = getAddress(usdgAsset.address);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const [usdgCode, usdgSymbol, usdgDecimals] = await Promise.all([
  client.getCode({ address: usdg }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: usdg, abi: erc20Abi, functionName: "decimals" }),
]);
if (!usdgCode || usdgSymbol !== "USDG" || usdgDecimals !== usdgAsset.decimals) {
  throw new Error("LAUNCHPAD_USDG_CONTEXT_INVALID");
}

async function artifact(name: string): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(
      path.join(artifactRoot, `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
  if (value.bytecode.object === "0x" || value.deployedBytecode.object === "0x") {
    throw new Error(`LAUNCHPAD_ARTIFACT_MISSING_${name}`);
  }
  return value;
}

const builds = {
  registry: await artifact("LaunchpadRegistry"),
  configManager: await artifact("LaunchpadConfigManager"),
  factory: await artifact("LaunchpadFactory"),
  feeController: await artifact("LaunchpadFeeController"),
  revenueSplitter: await artifact("RevenueSplitter"),
  feeCollector: await artifact("LaunchpadFeeCollector"),
  tokenFactory: await artifact("LaunchpadTokenFactory"),
  dbcFactory: await artifact("LaunchFactory"),
  lens: await artifact("LaunchpadLens"),
  proxy: await artifact("ERC1967Proxy"),
};
const deployer = getAddress(manifest.deployerAddress);
const admin = getAddress(manifest.governanceAddress);
const upgrader = getAddress(manifest.upgraderAddress);
const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const [adminCode, upgraderCode, safeOwners, safeThreshold, safeNonce, minDelay] =
  await Promise.all([
    client.getCode({ address: admin }),
    client.getCode({ address: upgrader }),
    client.readContract({ address: admin, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: admin, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: admin, abi: safeAbi, functionName: "nonce" }),
    client.readContract({ address: upgrader, abi: timelockAbi, functionName: "getMinDelay" }),
  ]);
if (!adminCode || !upgraderCode || safeThreshold < 2n || minDelay !== 300n) {
  throw new Error("LAUNCHPAD_GOVERNANCE_CONTEXT_INVALID");
}
const [proposerRole, executorRole, cancellerRole] = await Promise.all([
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "PROPOSER_ROLE" }),
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "EXECUTOR_ROLE" }),
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "CANCELLER_ROLE" }),
]);
const [safeCanPropose, safeCanExecute, safeCanCancel] = await Promise.all([
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "hasRole", args: [proposerRole, admin] }),
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "hasRole", args: [executorRole, admin] }),
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "hasRole", args: [cancellerRole, admin] }),
]);
if (!safeCanPropose || !safeCanExecute || !safeCanCancel) {
  throw new Error("LAUNCHPAD_TIMELOCK_ROLE_INVALID");
}
const defaultAdminRole = `0x${"00".repeat(32)}` as Hex;
const safeControlsDbc = await client.readContract({
  address: getAddress(manifest.dbc.launchFactory),
  abi: builds.dbcFactory.abi,
  functionName: "hasRole",
  args: [defaultAdminRole, admin],
});
if (!safeControlsDbc) throw new Error("LAUNCHPAD_DBC_ADMIN_INVALID");
const startingNonce = await client.getTransactionCount({
  address: deployer,
  blockTag: "pending",
});
const order = [
  "registryImplementation",
  "registry",
  "configManagerImplementation",
  "configManager",
  "factoryImplementation",
  "factory",
  "feeControllerImplementation",
  "feeController",
  "revenueSplitterImplementation",
  "revenueSplitter",
  "feeCollectorImplementation",
  "feeCollector",
  "tokenFactoryImplementation",
  "tokenFactory",
  "lens",
] as const;
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({
      from: deployer,
      nonce: BigInt(startingNonce + index),
    }),
  ]),
) as Record<(typeof order)[number], Address>;
const registryInit = encodeFunctionData({
  abi: builds.registry.abi,
  functionName: "initialize",
  args: [admin, upgrader, addresses.factory],
});
const configInit = encodeFunctionData({
  abi: builds.configManager.abi,
  functionName: "initialize",
  args: [admin, upgrader, admin],
});
const factoryInit = encodeFunctionData({
  abi: builds.factory.abi,
  functionName: "initialize",
  args: [admin, upgrader, addresses.registry, addresses.configManager],
});
const feeControllerInit = encodeFunctionData({
  abi: builds.feeController.abi,
  functionName: "initialize",
  args: [admin, upgrader, addresses.registry, admin],
});
const revenueSplitterInit = encodeFunctionData({
  abi: builds.revenueSplitter.abi,
  functionName: "initialize",
  args: [admin, upgrader],
});
const feeCollectorInit = encodeFunctionData({
  abi: builds.feeCollector.abi,
  functionName: "initialize",
  args: [admin, upgrader, addresses.revenueSplitter],
});
const tokenFactoryInit = encodeFunctionData({
  abi: builds.tokenFactory.abi,
  functionName: "initialize",
  args: [
    admin,
    upgrader,
    addresses.registry,
    addresses.configManager,
    getAddress(manifest.dbc.launchFactory),
    addresses.feeController,
    addresses.revenueSplitter,
    addresses.feeCollector,
  ],
});
const deploymentData: Record<(typeof order)[number], Hex> = {
  registryImplementation: builds.registry.bytecode.object,
  registry: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.registryImplementation, registryInit],
  }),
  configManagerImplementation: builds.configManager.bytecode.object,
  configManager: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.configManagerImplementation, configInit],
  }),
  factoryImplementation: builds.factory.bytecode.object,
  factory: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.factoryImplementation, factoryInit],
  }),
  feeControllerImplementation: builds.feeController.bytecode.object,
  feeController: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.feeControllerImplementation, feeControllerInit],
  }),
  revenueSplitterImplementation: builds.revenueSplitter.bytecode.object,
  revenueSplitter: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.revenueSplitterImplementation, revenueSplitterInit],
  }),
  feeCollectorImplementation: builds.feeCollector.bytecode.object,
  feeCollector: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.feeCollectorImplementation, feeCollectorInit],
  }),
  tokenFactoryImplementation: builds.tokenFactory.bytecode.object,
  tokenFactory: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.tokenFactoryImplementation, tokenFactoryInit],
  }),
  lens: encodeDeployData({
    abi: builds.lens.abi,
    bytecode: builds.lens.bytecode.object,
    args: [addresses.registry, addresses.configManager],
  }),
};
const factoryRole = keccak256(new TextEncoder().encode("ZKBLAST_FACTORY_ROLE"));
const dbcLaunchpadFactoryRole = keccak256(
  new TextEncoder().encode("ZKBLAST_DBC_LAUNCHPAD_FACTORY_ROLE"),
);
const accrualRole = keccak256(
  new TextEncoder().encode("ZKBLAST_LAUNCHPAD_FEE_ACCRUAL_ROLE"),
);
const configuration = [
  {
    target: addresses.configManager,
    description: "Authorize LaunchpadFactory on LaunchpadConfigManager",
    calldata: encodeFunctionData({
      abi: builds.configManager.abi,
      functionName: "setRole",
      args: [factoryRole, addresses.factory, true],
    }),
  },
  {
    target: getAddress(manifest.dbc.launchFactory),
    description: "Authorize LaunchpadTokenFactory on DBC LaunchFactory",
    calldata: encodeFunctionData({
      abi: builds.dbcFactory.abi,
      functionName: "setRole",
      args: [dbcLaunchpadFactoryRole, addresses.tokenFactory, true],
    }),
  },
  ...[
    [addresses.feeController, builds.feeController.abi, "LaunchpadFeeController"],
    [addresses.revenueSplitter, builds.revenueSplitter.abi, "RevenueSplitter"],
    [addresses.feeCollector, builds.feeCollector.abi, "LaunchpadFeeCollector"],
  ].map(([target, abi, label]) => ({
    target: target as Address,
    description: `Authorize LaunchpadTokenFactory on ${label as string}`,
    calldata: encodeFunctionData({
      abi: abi as Abi,
      functionName: "setRole",
      args: [factoryRole, addresses.tokenFactory, true],
    }),
  })),
  {
    target: addresses.revenueSplitter,
    description: "Authorize LaunchpadFeeCollector to accrue launchpad revenue",
    calldata: encodeFunctionData({
      abi: builds.revenueSplitter.abi,
      functionName: "setRole",
      args: [accrualRole, addresses.feeCollector, true],
    }),
  },
];
const latest = await client.getBlock();
const deploymentTransactions = order.map((name, index) => ({
  index,
  name,
  signer: deployer,
  nonce: startingNonce + index,
  predictedContractAddress: addresses[name],
  valueWei: "0",
  calldata: deploymentData[name],
  calldataHash: keccak256(deploymentData[name]),
}));
const governedTransactions = configuration.map((item, index) => ({
  index,
  signer: admin,
  safeNonce: (safeNonce + BigInt(index)).toString(),
  relayer: deployer,
  relayerNonce: startingNonce + order.length + index,
  target: item.target,
  valueWei: "0",
  operation: 0,
  description: item.description,
  calldata: item.calldata,
  calldataHash: keccak256(item.calldata),
}));
const plan = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  feature: "build-your-own-launchpad-v1",
  environment,
  chainId: expectedChainId,
  referenceBlock: latest.number.toString(),
  referenceBlockHash: latest.hash,
  deployer,
  startingNonce,
  deploymentTransactionCount: order.length,
  configurationTransactionCount: configuration.length,
  order,
  addresses,
  deploymentTransactions,
  governedTransactions,
  dependencies: {
    dbcConfigRegistry: getAddress(manifest.dbc.configRegistry),
    dbcLaunchFactory: getAddress(manifest.dbc.launchFactory),
    usdg,
    liveCodeHashes: {
      dbcConfigRegistry: keccak256(dbcRegistryCode),
      dbcLaunchFactory: keccak256(dbcFactoryCode),
      governanceSafe: keccak256(adminCode),
      upgraderTimelock: keccak256(upgraderCode),
      usdg: keccak256(usdgCode),
    },
    liveChecks: {
      safeControlsDbc,
      usdgSymbol,
      usdgDecimals,
    },
  },
  governance: {
    admin,
    adminKind: "Safe",
    safeOwners: safeOwners.map((owner) => getAddress(owner)),
    safeThreshold: safeThreshold.toString(),
    safeNonce: safeNonce.toString(),
    upgrader,
    upgraderKind: "ZKBlastTimelock",
    timelockConventionSeconds: Number(minDelay),
    safeRoles: { proposer: safeCanPropose, executor: safeCanExecute, canceller: safeCanCancel },
    deploymentSigner: deployer,
    configurationSigner: admin,
    upgradeScheduler: admin,
    upgradeExecutor: admin,
  },
  deploymentDataHashes: Object.fromEntries(
    Object.entries(deploymentData).map(([name, data]) => [name, keccak256(data)]),
  ),
  initializerCalldataHashes: {
    registry: keccak256(registryInit),
    configManager: keccak256(configInit),
    factory: keccak256(factoryInit),
    feeController: keccak256(feeControllerInit),
    revenueSplitter: keccak256(revenueSplitterInit),
    feeCollector: keccak256(feeCollectorInit),
    tokenFactory: keccak256(tokenFactoryInit),
  },
  configuration: configuration.map((item) => ({
    ...item,
    calldataHash: keccak256(item.calldata),
  })),
  safetyDefaults: {
    creationFeeWei: "0",
    hardMaximumTotalTradeFeeBps: 300,
    dammEnabledByInitializer: true,
    dlmmEnabledByInitializer: false,
    protocolFeeRecipient: admin,
    zkProofClaimsEnabled: false,
  },
  capabilityScope: {
    permissionlessLaunchpadCreation: true,
    permissionlessTokenLaunches: true,
    dammGraduation: true,
    dlmmGraduation: false,
    zkProofClaims: false,
    zkProofClaimsReason:
      "A launchpad-specific 15-public-input verifier is not present in the contract build; the unrelated perps verifier is deliberately excluded.",
  },
  authorization: {
    broadcastAllowed: false,
    activeManifestChanged: false,
    productionServicesChanged: false,
  },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(
  root,
  `deployments/${environment}/launchpad-v1-plan.json`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serialized);
console.log(
  JSON.stringify({
    environment,
    chainId: expectedChainId,
    referenceBlock: plan.referenceBlock,
    startingNonce,
    deploymentTransactions: order.length,
    configurationTransactions: configuration.length,
    registry: addresses.registry,
    factory: addresses.factory,
    planSha256: createHash("sha256").update(serialized).digest("hex"),
    broadcastAllowed: false,
  }),
);
