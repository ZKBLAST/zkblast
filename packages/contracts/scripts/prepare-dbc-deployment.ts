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
  toHex,
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
const out = path.join(root, "packages/contracts/out");
const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet")
  throw new Error("DBC_ENV_INVALID");
const expectedChainId = environment === "mainnet" ? 4663 : 46630;
if (Number(process.env.CHAIN_ID) !== expectedChainId || !process.env.RPC_URL)
  throw new Error("DBC_NETWORK_CONFIG_INVALID");
if (!process.env.EXECUTION_USDG_ADDRESS)
  throw new Error("DBC_QUOTE_TOKEN_REQUIRED");

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
  integration: { poolFactory: Address };
};
if (manifest.chainId !== expectedChainId)
  throw new Error("DBC_MANIFEST_CHAIN_MISMATCH");
const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
if ((await client.getChainId()) !== expectedChainId)
  throw new Error("DBC_RPC_CHAIN_MISMATCH");
const deployer = getAddress(manifest.deployerAddress),
  admin = getAddress(manifest.governanceAddress),
  upgrader = getAddress(manifest.upgraderAddress);
const quoteToken = getAddress(process.env.EXECUTION_USDG_ADDRESS),
  poolFactory = getAddress(manifest.integration.poolFactory);
const [quoteCode, factoryCode] = await Promise.all([
  client.getCode({ address: quoteToken }),
  client.getCode({ address: poolFactory }),
]);
if (!quoteCode || !factoryCode) throw new Error("DBC_DEPENDENCY_CODE_MISSING");

async function artifact(source: string, name = source): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(path.join(out, `${source}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
  if (value.bytecode.object === "0x" || value.deployedBytecode.object === "0x")
    throw new Error(`DBC_ARTIFACT_MISSING_${name}`);
  return value;
}
const builds = {
  registry: await artifact("LaunchConfigRegistry"),
  tokenDeployer: await artifact("LaunchTokenDeployer"),
  poolDeployer: await artifact("VirtualPoolDeployer"),
  factory: await artifact("LaunchFactory"),
  router: await artifact("LaunchpadRouter"),
  escrow: await artifact("LPAllocationEscrow"),
  manager: await artifact("GraduationManager"),
  quoter: await artifact("CurveQuoter"),
  adapter: await artifact("DammGraduationAdapter"),
  proxy: await artifact("ERC1967Proxy"),
};
const order = [
  "configRegistryImplementation",
  "configRegistry",
  "launchTokenDeployer",
  "virtualPoolDeployer",
  "launchFactoryImplementation",
  "launchFactory",
  "launchpadRouterImplementation",
  "launchpadRouter",
  "lpAllocationEscrowImplementation",
  "lpAllocationEscrow",
  "graduationManagerImplementation",
  "graduationManager",
  "curveQuoter",
  "dammGraduationAdapter",
] as const;
const startingNonce = await client.getTransactionCount({
  address: deployer,
  blockTag: "pending",
});
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({
      from: deployer,
      nonce: BigInt(startingNonce + index),
    }),
  ]),
) as Record<(typeof order)[number], Address>;
const initialize = (build: Artifact, args: readonly unknown[]) =>
  encodeFunctionData({ abi: build.abi, functionName: "initialize", args });
const init = {
  configRegistry: initialize(builds.registry, [admin, upgrader, admin]),
  launchFactory: initialize(builds.factory, [
    admin,
    upgrader,
    addresses.configRegistry,
    addresses.launchTokenDeployer,
    addresses.virtualPoolDeployer,
  ]),
  launchpadRouter: initialize(builds.router, [
    admin,
    upgrader,
    addresses.launchFactory,
  ]),
  lpAllocationEscrow: initialize(builds.escrow, [admin, upgrader]),
  graduationManager: initialize(builds.manager, [
    admin,
    upgrader,
    addresses.launchFactory,
    addresses.lpAllocationEscrow,
  ]),
};
const deploymentData: Record<string, Hex> = {
  configRegistryImplementation: builds.registry.bytecode.object,
  configRegistry: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.configRegistryImplementation, init.configRegistry],
  }),
  launchTokenDeployer: encodeDeployData({
    abi: builds.tokenDeployer.abi,
    bytecode: builds.tokenDeployer.bytecode.object,
    args: [admin],
  }),
  virtualPoolDeployer: encodeDeployData({
    abi: builds.poolDeployer.abi,
    bytecode: builds.poolDeployer.bytecode.object,
    args: [admin],
  }),
  launchFactoryImplementation: builds.factory.bytecode.object,
  launchFactory: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.launchFactoryImplementation, init.launchFactory],
  }),
  launchpadRouterImplementation: builds.router.bytecode.object,
  launchpadRouter: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.launchpadRouterImplementation, init.launchpadRouter],
  }),
  lpAllocationEscrowImplementation: builds.escrow.bytecode.object,
  lpAllocationEscrow: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.lpAllocationEscrowImplementation, init.lpAllocationEscrow],
  }),
  graduationManagerImplementation: builds.manager.bytecode.object,
  graduationManager: encodeDeployData({
    abi: builds.proxy.abi,
    bytecode: builds.proxy.bytecode.object,
    args: [addresses.graduationManagerImplementation, init.graduationManager],
  }),
  curveQuoter: builds.quoter.bytecode.object,
  dammGraduationAdapter: encodeDeployData({
    abi: builds.adapter.abi,
    bytecode: builds.adapter.bytecode.object,
    args: [addresses.graduationManager, poolFactory],
  }),
};
const factoryRole = keccak256(toHex("ZKBLAST_FACTORY_ROLE"));
const managerRole = keccak256(toHex("ZKBLAST_DBC_GRADUATION_MANAGER_ROLE"));
const template = {
  quoteToken,
  protocolFeeRecipient: admin,
  partnerFeeRecipient: admin,
  protocolLpRecipient: admin,
  quoteDecimals: 6,
  baseDecimals: 18,
  migrationMode: 0,
  destinationFeePips: 3_000,
  terminalPriceToleranceBps: 100,
  totalSupplyRaw: 1_000n * 10n ** 18n,
  baseInventoryRaw: 800n * 10n ** 18n,
  graduationThresholdRaw: 1_000_000n,
  minimumDestinationShares: 1n,
  curve: {
    segmentCount: 1,
    segments: Array.from({ length: 16 }, (_, index) =>
      index === 0
        ? {
            initialPriceX18: 1_000_000_000_000_000n,
            slopeX18: 1_000_000_000_000n,
            saleCapacityX18: 800n * 10n ** 18n,
          }
        : { initialPriceX18: 0n, slopeX18: 0n, saleCapacityX18: 0n },
    ),
  },
  fees: {
    tradeFeeBps: 30,
    creatorShareBps: 5_000,
    partnerShareBps: 0,
    protocolShareBps: 5_000,
  },
  lp: {
    creatorShareBps: 5_000,
    protocolShareBps: 5_000,
    creatorLockSeconds: 300,
  },
};
const configuration = [
  {
    name: "bindLaunchTokenDeployer",
    to: addresses.launchTokenDeployer,
    data: encodeFunctionData({
      abi: builds.tokenDeployer.abi,
      functionName: "bindFactory",
      args: [addresses.launchFactory],
    }),
  },
  {
    name: "bindVirtualPoolDeployer",
    to: addresses.virtualPoolDeployer,
    data: encodeFunctionData({
      abi: builds.poolDeployer.abi,
      functionName: "bindFactory",
      args: [addresses.launchFactory],
    }),
  },
  {
    name: "allowQuoteToken",
    to: addresses.configRegistry,
    data: encodeFunctionData({
      abi: builds.registry.abi,
      functionName: "setQuoteToken",
      args: [quoteToken, true],
    }),
  },
  {
    name: "authorizeFactory",
    to: addresses.configRegistry,
    data: encodeFunctionData({
      abi: builds.registry.abi,
      functionName: "setRole",
      args: [factoryRole, addresses.launchFactory, true],
    }),
  },
  {
    name: "bindGraduationManager",
    to: addresses.launchFactory,
    data: encodeFunctionData({
      abi: builds.factory.abi,
      functionName: "setGraduationManager",
      args: [addresses.graduationManager],
    }),
  },
  {
    name: "allowDammAdapter",
    to: addresses.graduationManager,
    data: encodeFunctionData({
      abi: builds.manager.abi,
      functionName: "setAdapter",
      args: [addresses.dammGraduationAdapter, true],
    }),
  },
  {
    name: "authorizeGraduationManager",
    to: addresses.lpAllocationEscrow,
    data: encodeFunctionData({
      abi: builds.escrow.abi,
      functionName: "setRole",
      args: [managerRole, addresses.graduationManager, true],
    }),
  },
  {
    name: "authorizeAdapterOnPoolFactory",
    to: poolFactory,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "setRole",
          stateMutability: "nonpayable",
          inputs: [
            { name: "role", type: "bytes32" },
            { name: "account", type: "address" },
            { name: "enabled", type: "bool" },
          ],
          outputs: [],
        },
      ],
      functionName: "setRole",
      args: [factoryRole, addresses.dammGraduationAdapter, true],
    }),
  },
  {
    name: "createMvpTemplate",
    to: addresses.configRegistry,
    data: encodeFunctionData({
      abi: builds.registry.abi,
      functionName: "createTemplate",
      args: [keccak256(toHex("ZKBLAST_DBC_LINEAR_V1")), template],
    }),
  },
];
const latest = await client.getBlock();
const plan = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  feature: "dbc-v1",
  environment,
  chainId: expectedChainId,
  referenceBlock: latest.number.toString(),
  referenceBlockHash: latest.hash,
  deployer,
  startingNonce,
  transactionCount: order.length + configuration.length,
  deploymentTransactionCount: order.length,
  configurationTransactionCount: configuration.length,
  order,
  addresses,
  dependencies: { quoteToken, poolFactory },
  governance: { admin, upgrader },
  deployments: Object.fromEntries(
    order.map((name) => [
      name,
      {
        address: addresses[name],
        creationBytecodeHash: keccak256(deploymentData[name]!),
        creationBytecodeBytes: (deploymentData[name]!.length - 2) / 2,
      },
    ]),
  ),
  initializationCalldataHashes: Object.fromEntries(
    Object.entries(init).map(([name, data]) => [name, keccak256(data)]),
  ),
  configuration: configuration.map((item) => ({
    ...item,
    calldataHash: keccak256(item.data),
  })),
  template,
  requiredBeforeBroadcast: [
    "focused gate succeeds once",
    "gas estimate and maximum spend are reported",
    "all predicted addresses remain empty",
    "deployer nonce remains unchanged",
    "explicit owner approval",
  ],
  authorization: {
    broadcastAllowed: false,
    privateKeyRead: false,
    activeManifestChanged: false,
  },
};
const json = (value: unknown, spacing?: number) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    spacing,
  );
const planSha256 = createHash("sha256")
  .update(
    json({
      chainId: plan.chainId,
      deployer: plan.deployer,
      startingNonce: plan.startingNonce,
      transactionCount: plan.transactionCount,
      addresses: plan.addresses,
      deployments: plan.deployments,
      initializationCalldataHashes: plan.initializationCalldataHashes,
      configuration: plan.configuration.map(({ name, to, calldataHash }) => ({
        name,
        to,
        calldataHash,
      })),
      template: plan.template,
    }),
  )
  .digest("hex");
const finalizedPlan = {
  ...plan,
  authorization: { ...plan.authorization, planSha256 },
};
const serialized = `${json(finalizedPlan, 2)}\n`;
const target = path.join(root, `deployments/${environment}/dbc-v1-plan.json`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, serialized, { mode: 0o644 });
console.log(
  JSON.stringify(
    {
      environment,
      chainId: expectedChainId,
      referenceBlock: plan.referenceBlock,
      startingNonce,
      transactionCount: plan.transactionCount,
      addresses,
      planSha256,
      fileSha256: createHash("sha256").update(serialized).digest("hex"),
      broadcastAllowed: false,
    },
    null,
    2,
  ),
);
