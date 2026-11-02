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
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

let preflightStage = "initialization";
const failSanitized = (reason: unknown) => {
  const code =
    typeof reason === "object" && reason !== null && "code" in reason
      ? String((reason as { code?: unknown }).code ?? "RPC_ERROR")
      : "RPC_ERROR";
  const rawMessage =
    typeof reason === "object" && reason !== null && "shortMessage" in reason
      ? String((reason as { shortMessage?: unknown }).shortMessage ?? "")
      : reason instanceof Error
        ? reason.message
        : "";
  const message = rawMessage
    .replace(/https?:\/\/\S+/giu, "[redacted-url]")
    .slice(0, 240);
  process.stderr.write(`DBC_DLMM_PREFLIGHT_FAILED:${preflightStage}:${code}:${message}\n`);
  process.exit(1);
};
process.on("uncaughtException", failSanitized);
process.on("unhandledRejection", failSanitized);

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
}>;
type Manifest = Readonly<{
  chainId: number;
  deployerAddress: Address;
  governanceAddress: Address;
  roles: { upgrader: Address };
  contracts?: { PoolFactory?: { upgraderAddress?: Address } };
  integration: { poolFactory: Address; poolRegistry: Address };
  dbc: {
    configRegistry: Address;
    graduationManager: Address;
    dammGraduationAdapter: Address;
    lpAllocationEscrow: Address;
  };
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const artifactRoot = path.join(root, "packages/contracts/out");
const rpcUrl = process.env.RPC_URL;
if (process.env.APP_ENV !== "testnet" || Number(process.env.CHAIN_ID) !== 46630 || !rpcUrl) {
  throw new Error("DBC_DLMM_TESTNET_CONTEXT_INVALID");
}
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/testnet/manifest.json"), "utf8"),
) as Manifest;
if (manifest.chainId !== 46630) throw new Error("DBC_DLMM_MANIFEST_CHAIN_INVALID");
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
preflightStage = "chain-context";
if ((await client.getChainId()) !== 46630) throw new Error("DBC_DLMM_RPC_CHAIN_INVALID");

async function artifact(name: string): Promise<Artifact> {
  const value = JSON.parse(
    await readFile(path.join(artifactRoot, `${name}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
  if (value.bytecode.object === "0x" || value.deployedBytecode.object === "0x") {
    throw new Error(`DBC_DLMM_ARTIFACT_MISSING_${name}`);
  }
  return value;
}

const builds = {
  poolFactory: await artifact("PoolFactory"),
  configRegistry: await artifact("LaunchConfigRegistry"),
  escrow: await artifact("LPAllocationEscrow"),
  manager: await artifact("GraduationManager"),
  dammAdapter: await artifact("DammGraduationAdapter"),
  dlmmAdapter: await artifact("DlmmGraduationAdapter"),
};
const deployer = getAddress(manifest.deployerAddress);
const governance = getAddress(manifest.governanceAddress);
const configuredUpgrader = getAddress(manifest.roles.upgrader);
const factoryTimelock = manifest.contracts?.PoolFactory?.upgraderAddress
  ? getAddress(manifest.contracts.PoolFactory.upgraderAddress)
  : configuredUpgrader;
const authorityCandidates = [...new Set([configuredUpgrader, factoryTimelock, governance])];
const proxies = {
  poolFactory: getAddress(manifest.integration.poolFactory),
  configRegistry: getAddress(manifest.dbc.configRegistry),
  escrow: getAddress(manifest.dbc.lpAllocationEscrow),
  manager: getAddress(manifest.dbc.graduationManager),
};
const liveDependencies = {
  poolRegistry: getAddress(manifest.integration.poolRegistry),
  oldDammAdapter: getAddress(manifest.dbc.dammGraduationAdapter),
};
preflightStage = "live-code";
const liveCode = await Promise.all(
  [...Object.values(proxies), ...Object.values(liveDependencies)].map((address) =>
    client.getCode({ address }),
  ),
);
if (liveCode.some((code) => !code || code === "0x")) throw new Error("DBC_DLMM_LIVE_CODE_MISSING");

const accessAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function permissionlessCreation() view returns (bool)",
]);
const upgraderRole = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
const defaultAdminRole = `0x${"00".repeat(32)}` as Hex;
preflightStage = "live-capabilities-and-roles";
const [block, nonce, gasPrice, permissionless, ...roleChecks] = await Promise.all([
  client.getBlock(),
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getGasPrice(),
  client.readContract({ address: proxies.poolFactory, abi: accessAbi, functionName: "permissionlessCreation" }),
  ...Object.values(proxies).flatMap((proxy) => [
    ...authorityCandidates.map((candidate) =>
      client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [upgraderRole, candidate] }),
    ),
    client.readContract({ address: proxy, abi: accessAbi, functionName: "hasRole", args: [defaultAdminRole, governance] }),
  ]),
]);
if (!permissionless) throw new Error("DBC_DLMM_FACTORY_NOT_PERMISSIONLESS");
const authorities = Object.fromEntries(
  Object.keys(proxies).map((name, index) => [
    name,
    {
      upgrader: authorityCandidates.find(
        (_, candidateIndex) => Boolean(roleChecks[index * (authorityCandidates.length + 1) + candidateIndex]),
      ) ?? null,
      governanceAdmin: Boolean(roleChecks[index * (authorityCandidates.length + 1) + authorityCandidates.length]),
    },
  ]),
) as Record<string, { upgrader: Address | null; governanceAdmin: boolean }>;
if (Object.values(authorities).some((item) => item.upgrader === null || !item.governanceAdmin)) {
  throw new Error("DBC_DLMM_LIVE_AUTHORITY_MISMATCH");
}

const deploymentOrder = [
  "poolFactoryImplementation",
  "configRegistryImplementation",
  "escrowImplementation",
  "managerImplementation",
  "dammAdapter",
  "dlmmAdapter",
] as const;
const addresses = Object.fromEntries(
  deploymentOrder.map((name, index) => [
    name,
    getContractAddress({ from: deployer, nonce: BigInt(nonce + index) }),
  ]),
) as Record<(typeof deploymentOrder)[number], Address>;
const creationData: Record<(typeof deploymentOrder)[number], Hex> = {
  poolFactoryImplementation: builds.poolFactory.bytecode.object,
  configRegistryImplementation: builds.configRegistry.bytecode.object,
  escrowImplementation: builds.escrow.bytecode.object,
  managerImplementation: builds.manager.bytecode.object,
  dammAdapter: encodeDeployData({
    abi: builds.dammAdapter.abi,
    bytecode: builds.dammAdapter.bytecode.object,
    args: [proxies.manager, proxies.poolFactory],
  }),
  dlmmAdapter: encodeDeployData({
    abi: builds.dlmmAdapter.abi,
    bytecode: builds.dlmmAdapter.bytecode.object,
    args: [proxies.manager, proxies.poolFactory, governance, 25],
  }),
};
const proxyAbi = parseAbi(["function upgradeToAndCall(address,bytes)"]);
const upgrades = [
  ["poolFactory", addresses.poolFactoryImplementation],
  ["configRegistry", addresses.configRegistryImplementation],
  ["escrow", addresses.escrowImplementation],
  ["manager", addresses.managerImplementation],
] as const;
const adminCalls = [
  { name: "disableLegacyDammAdapter", args: [liveDependencies.oldDammAdapter, false] as const },
  { name: "allowVersionedDammAdapter", args: [addresses.dammAdapter, true] as const },
  { name: "allowVersionedDlmmAdapter", args: [addresses.dlmmAdapter, true] as const },
].map((item) => ({
  name: item.name,
  to: proxies.manager,
  data: encodeFunctionData({
    abi: builds.manager.abi,
    functionName: "setAdapter",
    args: item.args,
  }),
}));
const upgradeCalls = upgrades.map(([name, implementation]) => ({
  name: `upgrade-${name}`,
  to: proxies[name],
  data: encodeFunctionData({ abi: proxyAbi, functionName: "upgradeToAndCall", args: [implementation, "0x"] }),
}));
const deploymentGas = await Promise.all(
  (preflightStage = "deployment-gas-estimation",
  deploymentOrder.map((name) =>
    client.estimateGas({ account: deployer, data: creationData[name] }),
  )),
);
// The predicted implementations/adapters do not have code until their deployment
// receipts exist, so eth_estimateGas would correctly reject the dependent calls.
// Use an explicit conservative ceiling here and re-estimate against deployed code
// before any future broadcast stage.
const upgradeGas = upgradeCalls.map(() => 100_000n);
const adminGas = adminCalls.map(() => 100_000n);
const timelockedUpgradeCount = Object.values(authorities).filter(
  (item) => item.upgrader === factoryTimelock,
).length;
// Replace each direct 100k upgrade allowance with 300k combined schedule+execute allowance.
const timelockWrapperGas = BigInt(timelockedUpgradeCount) * 200_000n;
const totalGas = [...deploymentGas, ...upgradeGas, ...adminGas].reduce((sum, value) => sum + value, 0n)
  + timelockWrapperGas;
const bufferedGas = totalGas * 120n / 100n;
const plan = {
  schemaVersion: 1,
  feature: "dbc-dlmm-graduation-v1",
  environment: "testnet",
  chainId: 46630,
  referenceBlock: block.number.toString(),
  referenceBlockHash: block.hash,
  deployer,
  governance,
  configuredUpgrader,
  factoryTimelock,
  startingNonce: nonce,
  proxies,
  liveDependencies,
  authorities,
  executionShape: {
    deploymentTransactions: deploymentOrder.length,
    directUpgradeTransactions: upgradeCalls.length - timelockedUpgradeCount,
    timelockScheduleTransactions: timelockedUpgradeCount,
    timelockExecuteTransactions: timelockedUpgradeCount,
    adminTransactions: adminCalls.length,
    totalTransactions: deploymentOrder.length + upgradeCalls.length + timelockedUpgradeCount + adminCalls.length,
  },
  permissionlessFactory: permissionless,
  deploymentOrder,
  addresses,
  deploymentDataHashes: Object.fromEntries(
    deploymentOrder.map((name) => [name, keccak256(creationData[name])]),
  ),
  upgradeCalls: upgradeCalls.map((call, index) => ({ ...call, estimatedGas: upgradeGas[index]!.toString() })),
  adminCalls: adminCalls.map((call, index) => ({ ...call, estimatedGas: adminGas[index]!.toString() })),
  estimates: {
    deploymentGas: Object.fromEntries(deploymentOrder.map((name, index) => [name, deploymentGas[index]!.toString()])),
    totalGas: totalGas.toString(),
    bufferedGas: bufferedGas.toString(),
    gasPriceWei: gasPrice.toString(),
    bufferedMaximumFeeWei: (bufferedGas * gasPrice).toString(),
    timelockWrapperGas: timelockWrapperGas.toString(),
    dependentCallGasPolicy: "100000 conservative pre-deployment ceiling per call; mandatory live re-estimate after deployment",
  },
  activation: {
    dlmmDestinationEnabled: false,
    testnetCanaryGraduationRequired: true,
    canaryQuoteDecimals: 18,
    reason: "The current 6-decimal USDG/raw-price combination is outside the v1 DLMM bin range.",
  },
  authorization: { broadcastAllowed: false, privateKeyRead: false, manifestChanged: false },
};
const json = JSON.stringify(plan, null, 2) + "\n";
const output = path.join(root, "deployments/testnet/dbc-dlmm-graduation-plan.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, json, { mode: 0o644 });
console.log(JSON.stringify({
  referenceBlock: plan.referenceBlock,
  startingNonce: nonce,
  transactions: plan.executionShape.totalTransactions,
  bufferedMaximumFeeWei: plan.estimates.bufferedMaximumFeeWei,
  planSha256: createHash("sha256").update(json).digest("hex"),
  output,
  broadcastAllowed: false,
}, null, 2));
