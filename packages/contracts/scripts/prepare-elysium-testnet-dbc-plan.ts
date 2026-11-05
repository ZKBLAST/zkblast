import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: Readonly<{ object: Hex }>;
  deployedBytecode: Readonly<{ object: Hex }>;
}>;
type Preflight = Readonly<{
  chain: { chainId: number; blockNumber: number; blockHash: Hex; gasPriceWei: string };
  roles: {
    deployer: Address;
    governance: Address;
    upgrader: Address;
    pauser: Address;
    keeper: Address;
    feeRecipient: Address;
  };
  deployer: { pendingNonce: number; balanceWei: string };
  governancePlan: { predictedTimelock: Address; deploymentNonce: number };
  gates: { rolesComplete: boolean; transactionBroadcast: boolean };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const preflight = JSON.parse(
  await readFile(path.join(directory, "preflight.json"), "utf8"),
) as Preflight;
if (
  preflight.chain.chainId !== 99_801 ||
  !preflight.gates.rolesComplete ||
  preflight.gates.transactionBroadcast ||
  preflight.governancePlan.deploymentNonce !== preflight.deployer.pendingNonce
) {
  throw new Error("ELYSIUM_PREFLIGHT_CONTEXT_INVALID");
}
const deployer = getAddress(preflight.roles.deployer);
const governance = getAddress(preflight.roles.governance);
const upgrader = getAddress(preflight.roles.upgrader);
if (
  upgrader !== getContractAddress({
    from: deployer,
    nonce: BigInt(preflight.deployer.pendingNonce),
  })
) {
  throw new Error("ELYSIUM_TIMELOCK_PREDICTION_CHANGED");
}

const names = [
  "LaunchConfigRegistry",
  "LaunchTokenDeployer",
  "VirtualPoolDeployer",
  "LaunchFactory",
  "LaunchpadRouter",
  "LPAllocationEscrow",
  "GraduationManager",
  "CurveQuoter",
  "ERC1967Proxy",
] as const;
const artifacts = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => {
      const value = JSON.parse(
        await readFile(
          path.join(
            root,
            `packages/contracts/out-elysium/${name}.sol/${name}.json`,
          ),
          "utf8",
        ),
      ) as Artifact;
      if (value.bytecode.object === "0x" || value.deployedBytecode.object === "0x")
        throw new Error(`ELYSIUM_ARTIFACT_EMPTY:${name}`);
      if ((value.deployedBytecode.object.length - 2) / 2 > 24_576)
        throw new Error(`ELYSIUM_RUNTIME_TOO_LARGE:${name}`);
      return [name, value] as const;
    }),
  ),
) as Record<(typeof names)[number], Artifact>;

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
] as const;
const startingNonce = preflight.deployer.pendingNonce + 1;
const addresses = Object.fromEntries(
  order.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(startingNonce + index) }),
  ]),
) as Record<(typeof order)[number], Address>;
const init = (name: (typeof names)[number], args: readonly unknown[]): Hex =>
  encodeFunctionData({ abi: artifacts[name].abi, functionName: "initialize", args });
const initializer = {
  configRegistry: init("LaunchConfigRegistry", [governance, upgrader, governance]),
  launchFactory: init("LaunchFactory", [
    governance,
    upgrader,
    addresses.configRegistry,
    addresses.launchTokenDeployer,
    addresses.virtualPoolDeployer,
  ]),
  launchpadRouter: init("LaunchpadRouter", [governance, upgrader, addresses.launchFactory]),
  lpAllocationEscrow: init("LPAllocationEscrow", [governance, upgrader]),
  graduationManager: init("GraduationManager", [
    governance,
    upgrader,
    addresses.launchFactory,
    addresses.lpAllocationEscrow,
  ]),
};
const proxy = (implementation: Address, data: Hex): Hex =>
  encodeDeployData({
    abi: artifacts.ERC1967Proxy.abi,
    bytecode: artifacts.ERC1967Proxy.bytecode.object,
    args: [implementation, data],
  });
const deploymentData: Record<(typeof order)[number], Hex> = {
  configRegistryImplementation: artifacts.LaunchConfigRegistry.bytecode.object,
  configRegistry: proxy(addresses.configRegistryImplementation, initializer.configRegistry),
  launchTokenDeployer: encodeDeployData({
    abi: artifacts.LaunchTokenDeployer.abi,
    bytecode: artifacts.LaunchTokenDeployer.bytecode.object,
    args: [governance],
  }),
  virtualPoolDeployer: encodeDeployData({
    abi: artifacts.VirtualPoolDeployer.abi,
    bytecode: artifacts.VirtualPoolDeployer.bytecode.object,
    args: [governance],
  }),
  launchFactoryImplementation: artifacts.LaunchFactory.bytecode.object,
  launchFactory: proxy(addresses.launchFactoryImplementation, initializer.launchFactory),
  launchpadRouterImplementation: artifacts.LaunchpadRouter.bytecode.object,
  launchpadRouter: proxy(addresses.launchpadRouterImplementation, initializer.launchpadRouter),
  lpAllocationEscrowImplementation: artifacts.LPAllocationEscrow.bytecode.object,
  lpAllocationEscrow: proxy(addresses.lpAllocationEscrowImplementation, initializer.lpAllocationEscrow),
  graduationManagerImplementation: artifacts.GraduationManager.bytecode.object,
  graduationManager: proxy(addresses.graduationManagerImplementation, initializer.graduationManager),
  curveQuoter: artifacts.CurveQuoter.bytecode.object,
};
const factoryRole = keccak256(toHex("ZKBLAST_FACTORY_ROLE"));
const managerRole = keccak256(toHex("ZKBLAST_DBC_GRADUATION_MANAGER_ROLE"));
const quoteToken = getAddress("0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234");
const template = {
  quoteToken,
  protocolFeeRecipient: governance,
  partnerFeeRecipient: governance,
  protocolLpRecipient: governance,
  quoteDecimals: 18,
  baseDecimals: 18,
  migrationMode: 0,
  destinationFeePips: 3_000,
  terminalPriceToleranceBps: 100,
  totalSupplyRaw: 1_000_000n * 10n ** 18n,
  baseInventoryRaw: 800_000n * 10n ** 18n,
  graduationThresholdRaw: 10n ** 16n,
  minimumDestinationShares: 1n,
  curve: {
    segmentCount: 1,
    segments: Array.from({ length: 16 }, (_, index) =>
      index === 0
        ? {
            initialPriceX18: 1_000_000_000_000n,
            slopeX18: 1_000_000n,
            saleCapacityX18: 800_000n * 10n ** 18n,
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
const config = (
  name: string,
  to: Address,
  abiName: (typeof names)[number],
  functionName: string,
  args: readonly unknown[],
) => ({
  name,
  to,
  data: encodeFunctionData({ abi: artifacts[abiName].abi, functionName, args }),
});
const configurations = [
  config("bindLaunchTokenDeployer", addresses.launchTokenDeployer, "LaunchTokenDeployer", "bindFactory", [addresses.launchFactory]),
  config("bindVirtualPoolDeployer", addresses.virtualPoolDeployer, "VirtualPoolDeployer", "bindFactory", [addresses.launchFactory]),
  config("allowWhypeQuoteToken", addresses.configRegistry, "LaunchConfigRegistry", "setQuoteToken", [quoteToken, true]),
  config("authorizeLaunchFactory", addresses.configRegistry, "LaunchConfigRegistry", "setRole", [factoryRole, addresses.launchFactory, true]),
  config("bindGraduationManager", addresses.launchFactory, "LaunchFactory", "setGraduationManager", [addresses.graduationManager]),
  config("authorizeGraduationManager", addresses.lpAllocationEscrow, "LPAllocationEscrow", "setRole", [managerRole, addresses.graduationManager, true]),
  config("createWhypeCanaryTemplate", addresses.configRegistry, "LaunchConfigRegistry", "createTemplate", [keccak256(toHex("ZKBLAST_ELYSIUM_WHYPE_CANARY_V1")), template]),
  config("createWhypeCanaryLaunch", addresses.launchFactory, "LaunchFactory", "createLaunch", [{
    templateId: 1n,
    salt: keccak256(toHex("ZKBLAST_ELYSIUM_LOCAL_CANARY_V1")),
    name: "ZKBLAST Elysium Canary",
    symbol: "ZKEC",
    metadataURI: "ipfs://zkblast-elysium-local-canary",
    creatorTokenRecipient: governance,
  }]),
];
const configurationStart = startingNonce + order.length;
const report = {
  schemaVersion: 1,
  chainId: 99_801,
  kind: "offline-elysium-dbc-deployment-plan",
  generatedAt: new Date().toISOString(),
  referenceBlock: preflight.chain.blockNumber,
  referenceBlockHash: preflight.chain.blockHash,
  deployer,
  governance,
  upgrader,
  startingNonce,
  deploymentTransactionCount: order.length,
  configurationTransactionCount: configurations.length,
  transactionCount: order.length + configurations.length,
  nextNonce: configurationStart + configurations.length,
  addresses,
  deployments: order.map((name, index) => ({
    nonce: startingNonce + index,
    name,
    predictedContractAddress: addresses[name],
    data: deploymentData[name],
    dataHash: keccak256(deploymentData[name]),
  })),
  initializerHashes: Object.fromEntries(
    Object.entries(initializer).map(([name, data]) => [name, keccak256(data)]),
  ),
  configurations: configurations.map((item, index) => ({
    nonce: configurationStart + index,
    ...item,
    dataHash: keccak256(item.data),
  })),
  artifacts: Object.fromEntries(
    Object.entries(artifacts).map(([name, artifact]) => [name, {
      creationBytecodeHash: keccak256(artifact.bytecode.object),
      runtimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
      runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
    }]),
  ),
  graduation: { status: "pending-adapter", adapter: null },
  planSha256: "",
  gates: {
    privateKeysRead: false,
    broadcastAllowed: false,
    sequentialSimulationPassed: false,
    exactGasEstimateReady: false,
  },
};
report.planSha256 = createHash("sha256")
  .update(JSON.stringify(report))
  .digest("hex");
await writeFile(
  path.join(directory, "dbc-deployment-plan.json"),
  `${JSON.stringify(report, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`,
  { mode: 0o644 },
);
console.log(JSON.stringify({
  transactionCount: report.transactionCount,
  nonceRange: `${report.startingNonce}-${report.nextNonce - 1}`,
  launchFactory: addresses.launchFactory,
  graduation: report.graduation.status,
  planSha256: report.planSha256,
  broadcastAllowed: false,
}, null, 2));
