import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{ abi: Abi; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet")
  throw new Error("DBC_VERIFY_ENV_INVALID");
const expectedChainId = environment === "mainnet" ? 4663 : 46630;
if (Number(process.env.CHAIN_ID) !== expectedChainId || !process.env.RPC_URL)
  throw new Error("DBC_VERIFY_ENV_INVALID");
const plan = JSON.parse(
  await readFile(
    path.join(root, `deployments/${environment}/dbc-v1-plan.json`),
    "utf8",
  ),
);
const deploymentPath = path.join(
  root,
  `deployments/${environment}/dbc-v1-deployment.json`,
);
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
const manifest = JSON.parse(
  await readFile(
    path.join(root, `deployments/${environment}/manifest.json`),
    "utf8",
  ),
);
if (
  deployment.planSha256 !== plan.authorization.planSha256 ||
  manifest.chainId !== expectedChainId
)
  throw new Error("DBC_VERIFY_PLAN_MISMATCH");
const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
if ((await client.getChainId()) !== expectedChainId)
  throw new Error("DBC_VERIFY_CHAIN_MISMATCH");
const artifact = async (name: string) =>
  JSON.parse(
    await readFile(
      path.join(root, "packages/contracts/out", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
const builds = {
  registry: await artifact("LaunchConfigRegistry"),
  factory: await artifact("LaunchFactory"),
  router: await artifact("LaunchpadRouter"),
  escrow: await artifact("LPAllocationEscrow"),
  manager: await artifact("GraduationManager"),
  tokenDeployer: await artifact("LaunchTokenDeployer"),
  poolDeployer: await artifact("VirtualPoolDeployer"),
};
const addresses = plan.addresses as Record<string, Address>;
const proxySlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const proxyPairs = [
  ["configRegistry", "configRegistryImplementation"],
  ["launchFactory", "launchFactoryImplementation"],
  ["launchpadRouter", "launchpadRouterImplementation"],
  ["lpAllocationEscrow", "lpAllocationEscrowImplementation"],
  ["graduationManager", "graduationManagerImplementation"],
] as const;
const codeEntries = await Promise.all(
  Object.entries(addresses).map(async ([name, address]) => {
    const code = await client.getCode({ address });
    if (!code) throw new Error(`DBC_CODE_MISSING_${name}`);
    return [
      name,
      {
        address,
        runtimeBytecodeHash: keccak256(code),
        runtimeBytecodeBytes: (code.length - 2) / 2,
      },
    ] as const;
  }),
);
for (const [proxy, implementation] of proxyPairs) {
  const stored = await client.getStorageAt({
    address: addresses[proxy]!,
    slot: proxySlot,
  });
  if (
    !stored ||
    getAddress(`0x${stored.slice(-40)}`) !==
      getAddress(addresses[implementation]!)
  )
    throw new Error(`DBC_IMPLEMENTATION_SLOT_MISMATCH_${proxy}`);
}
const read = <T>(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) => client.readContract({ address, abi, functionName, args }) as Promise<T>;
const admin = getAddress(plan.governance.admin),
  upgrader = getAddress(plan.governance.upgrader),
  factoryRole = keccak256(toHex("ZKBLAST_FACTORY_ROLE")),
  managerRole = keccak256(toHex("ZKBLAST_DBC_GRADUATION_MANAGER_ROLE"));
for (const [name, build] of [
  ["configRegistry", builds.registry],
  ["launchFactory", builds.factory],
  ["launchpadRouter", builds.router],
  ["lpAllocationEscrow", builds.escrow],
  ["graduationManager", builds.manager],
] as const) {
  if (
    !(await read<boolean>(addresses[name]!, build.abi, "hasRole", [
      `0x${"0".repeat(64)}`,
      admin,
    ])) ||
    !(await read<boolean>(addresses[name]!, build.abi, "hasRole", [
      keccak256(toHex("ZKBLAST_UPGRADER_ROLE")),
      upgrader,
    ]))
  )
    throw new Error(`DBC_ROLE_MISMATCH_${name}`);
}
const checks = {
  quoteTokenAllowed: await read<boolean>(
    addresses.configRegistry!,
    builds.registry.abi,
    "quoteTokenAllowed",
    [plan.dependencies.quoteToken],
  ),
  factoryAuthorized: await read<boolean>(
    addresses.configRegistry!,
    builds.registry.abi,
    "hasRole",
    [factoryRole, addresses.launchFactory],
  ),
  tokenDeployerFactory: await read<Address>(
    addresses.launchTokenDeployer!,
    builds.tokenDeployer.abi,
    "factory",
  ),
  poolDeployerFactory: await read<Address>(
    addresses.virtualPoolDeployer!,
    builds.poolDeployer.abi,
    "factory",
  ),
  graduationManager: await read<Address>(
    addresses.launchFactory!,
    builds.factory.abi,
    "graduationManager",
  ),
  adapterAllowed: await read<boolean>(
    addresses.graduationManager!,
    builds.manager.abi,
    "adapterAllowed",
    [addresses.dammGraduationAdapter],
  ),
  managerAuthorized: await read<boolean>(
    addresses.lpAllocationEscrow!,
    builds.escrow.abi,
    "hasRole",
    [managerRole, addresses.graduationManager],
  ),
  templateCount: (
    await read<bigint>(
      addresses.configRegistry!,
      builds.registry.abi,
      "templateCount",
    )
  ).toString(),
};
if (
  !checks.quoteTokenAllowed ||
  !checks.factoryAuthorized ||
  getAddress(checks.tokenDeployerFactory) !==
    getAddress(addresses.launchFactory!) ||
  getAddress(checks.poolDeployerFactory) !==
    getAddress(addresses.launchFactory!) ||
  getAddress(checks.graduationManager) !==
    getAddress(addresses.graduationManager!) ||
  !checks.adapterAllowed ||
  !checks.managerAuthorized ||
  checks.templateCount !== "1"
)
  throw new Error("DBC_CONFIGURATION_VERIFICATION_FAILED");
const verification = {
  verifiedAt: new Date().toISOString(),
  chainId: expectedChainId,
  referenceBlock: (await client.getBlockNumber()).toString(),
  planSha256: plan.authorization.planSha256,
  contracts: Object.fromEntries(codeEntries),
  proxySlots: Object.fromEntries(
    proxyPairs.map(([proxy, implementation]) => [
      proxy,
      { implementation: addresses[implementation] },
    ]),
  ),
  checks,
  status: "verified-onchain",
  sourceVerification:
    environment === "mainnet"
      ? "pending-mandatory"
      : "waived-testnet-owner-approved",
};
await writeFile(
  deploymentPath,
  `${JSON.stringify({ ...deployment, verification }, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(
  JSON.stringify(
    {
      status: verification.status,
      sourceVerification: verification.sourceVerification,
      referenceBlock: verification.referenceBlock,
      contracts: codeEntries.length,
      checks,
    },
    null,
    2,
  ),
);
