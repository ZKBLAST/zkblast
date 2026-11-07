import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  erc20Abi,
  launchConfigRegistryAbi,
  launchpadConfigManagerAbi,
  launchpadRegistryAbi,
  virtualPoolAbi,
} from "@zkblast/abi";
import { getChainDescriptor } from "@zkblast/config";
import type { DbcAddresses, LaunchpadAddresses } from "@zkblast/sdk";
import { createPublicClient, getAddress, http, zeroAddress, type Address } from "viem";
import type { ApiChainContext } from "./app.js";
import { DbcService } from "./dbc-service.js";
import { LaunchpadBrandingService } from "./launchpad-branding-service.js";
import { LaunchpadCatalogService } from "./launchpad-catalog-service.js";
import { LaunchpadReadService } from "./launchpad-read-service.js";
import { PostgresDbcReadStore } from "./postgres-dbc-read-store.js";
import { PostgresLaunchpadBrandingStore } from "./postgres-launchpad-branding-store.js";
import { PostgresLaunchpadReadStore } from "./postgres-launchpad-read-store.js";

const CHAIN_ID = 99_801;
const SCHEMA = "zkblast_elysium_testnet";
const MANIFEST_PATH = "deployments/elysium-testnet/manifest.json";

type AddressGroup = Record<string, Address>;
type ElysiumManifest = Readonly<{
  chain: { chainId: number; environment: "testnet" };
  plans: {
    dbc: { addresses: AddressGroup };
    launchpad: { addresses: AddressGroup };
    protectedLaunch: { addresses: AddressGroup };
  };
  verification: { passed: boolean; codeChecks: number; proxyChecks: number };
}>;

const publicContracts = (manifest: ElysiumManifest) => {
  const contracts: Array<
    NonNullable<ApiChainContext["config"]["contracts"]>[number]
  > = [];
  const add = (
    name: string,
    address: Address,
    implementationAddress?: Address,
  ) => {
    contracts.push({
      name,
      proxyKind: implementationAddress ? "uups" : "none",
      address: getAddress(address),
      proxyAddress: implementationAddress ? getAddress(address) : null,
      implementationAddress: getAddress(implementationAddress ?? address),
      verification: {
        implementation: "pending",
        proxy: implementationAddress ? "pending" : "not_applicable",
        urls: [],
      },
    });
  };
  const dbc = manifest.plans.dbc.addresses;
  const launchpad = manifest.plans.launchpad.addresses;
  const protectedLaunch = manifest.plans.protectedLaunch.addresses;
  add("LaunchConfigRegistry", dbc.configRegistry!, dbc.configRegistryImplementation);
  add("DbcLaunchFactory", dbc.launchFactory!, dbc.launchFactoryImplementation);
  add("DbcCurveQuoter", dbc.curveQuoter!);
  add("DbcLaunchpadRouter", dbc.launchpadRouter!, dbc.launchpadRouterImplementation);
  add("DbcGraduationManager", dbc.graduationManager!, dbc.graduationManagerImplementation);
  add("DbcLpAllocationEscrow", dbc.lpAllocationEscrow!, dbc.lpAllocationEscrowImplementation);
  add("LaunchpadRegistry", launchpad.registry!, launchpad.registryImplementation);
  add("LaunchpadConfigManager", launchpad.configManager!, launchpad.configManagerImplementation);
  add("LaunchpadFactory", launchpad.factory!, launchpad.factoryImplementation);
  add("LaunchpadLens", launchpad.lens!);
  add("LaunchpadFeeController", launchpad.feeController!, launchpad.feeControllerImplementation);
  add("LaunchpadRevenueSplitter", launchpad.revenueSplitter!, launchpad.revenueSplitterImplementation);
  add("LaunchpadFeeCollector", launchpad.feeCollector!, launchpad.feeCollectorImplementation);
  add("LaunchpadTokenFactory", launchpad.tokenFactory!, launchpad.tokenFactoryImplementation);
  add("ProtectedLaunchPolicyRegistry", protectedLaunch.policyRegistry!, protectedLaunch.policyRegistryImplementation);
  add("ProtectedLaunchFactory", protectedLaunch.factory!, protectedLaunch.factoryImplementation);
  add("ProtectedLaunchRouter", protectedLaunch.router!, protectedLaunch.routerImplementation);
  add("ProtectedLaunchLpEscrow", protectedLaunch.lpEscrow!, protectedLaunch.lpEscrowImplementation);
  add("ProtectedLaunchGraduationManager", protectedLaunch.graduationManager!, protectedLaunch.graduationManagerImplementation);
  add("ProtectedLaunchIdentityRegistry", protectedLaunch.identityRegistry!, protectedLaunch.identityRegistryImplementation);
  return contracts;
};

/**
 * Publishes the Elysium network boundary before contracts are deployed.
 * Execution dependencies are deliberately absent, so every feature route
 * fails closed until a receipt-backed manifest is installed.
 */
export async function createElysiumTestnetContext(input: Readonly<{
  databaseUrl: string;
  rpcUrl: string;
  webOrigin: string;
}>): Promise<ApiChainContext> {
  const descriptor = getChainDescriptor(CHAIN_ID);
  if (descriptor.family !== "elysium" || descriptor.environment !== "testnet")
    throw new Error("ELYSIUM_TESTNET_DESCRIPTOR_MISMATCH");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = JSON.parse(
    await readFile(resolve(root, MANIFEST_PATH), "utf8"),
  ) as ElysiumManifest;
  if (
    manifest.chain.chainId !== CHAIN_ID ||
    manifest.chain.environment !== "testnet" ||
    !manifest.verification.passed ||
    manifest.verification.codeChecks !== 42 ||
    manifest.verification.proxyChecks !== 18
  ) {
    throw new Error("ELYSIUM_TESTNET_MANIFEST_INVALID");
  }
  const client = createPublicClient({ cacheTime: 0, transport: http(input.rpcUrl) });
  if ((await client.getChainId()) !== CHAIN_ID)
    throw new Error("ELYSIUM_TESTNET_RPC_CHAIN_MISMATCH");

  const dbc = manifest.plans.dbc.addresses;
  const launchpad = manifest.plans.launchpad.addresses;
  const primaryAddresses = [
    dbc.configRegistry!,
    dbc.launchFactory!,
    launchpad.registry!,
    launchpad.configManager!,
  ];
  const code = await Promise.all(
    primaryAddresses.map((address) => client.getCode({ address })),
  );
  if (code.some((value) => !value || value === "0x"))
    throw new Error("ELYSIUM_TESTNET_RUNTIME_CODE_MISSING");

  const dbcAddresses: DbcAddresses = {
    abiVersion: 1,
    configRegistry: getAddress(dbc.configRegistry!),
    launchTokenDeployer: getAddress(dbc.launchTokenDeployer!),
    virtualPoolDeployer: getAddress(dbc.virtualPoolDeployer!),
    launchFactory: getAddress(dbc.launchFactory!),
    curveQuoter: getAddress(dbc.curveQuoter!),
    launchpadRouter: getAddress(dbc.launchpadRouter!),
    graduationManager: getAddress(dbc.graduationManager!),
    dammGraduationAdapter: zeroAddress,
    lpAllocationEscrow: getAddress(dbc.lpAllocationEscrow!),
  };
  const launchpadAddresses: LaunchpadAddresses = {
    abiVersion: 1,
    registry: getAddress(launchpad.registry!),
    configManager: getAddress(launchpad.configManager!),
    factory: getAddress(launchpad.factory!),
    lens: getAddress(launchpad.lens!),
    feeController: getAddress(launchpad.feeController!),
    revenueSplitter: getAddress(launchpad.revenueSplitter!),
    feeCollector: getAddress(launchpad.feeCollector!),
    tokenFactory: getAddress(launchpad.tokenFactory!),
  };
  const dbcService = new DbcService(
    new PostgresDbcReadStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    {
      quote: ({ pool, side, amountRaw }) =>
        client.readContract({
          address: pool,
          abi: virtualPoolAbi,
          functionName: side === "buy" ? "quoteBuyExactInput" : "quoteSellExactInput",
          args: [amountRaw],
        }),
      templateEconomics: (templateId) =>
        client.readContract({
          address: dbcAddresses.configRegistry,
          abi: launchConfigRegistryAbi,
          functionName: "templateEconomics",
          args: [templateId],
        }),
      templateConfig: (templateId) =>
        client.readContract({
          address: dbcAddresses.configRegistry,
          abi: launchConfigRegistryAbi,
          functionName: "templateConfig",
          args: [templateId],
        }),
      tokenMetadata: async (token) => {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
        ]);
        return { symbol, decimals };
      },
    },
    dbcAddresses,
  );
  const launchpadCatalogService = new LaunchpadCatalogService(
    "testnet",
    CHAIN_ID,
    launchpadAddresses,
    {
      launchpadCount: () => client.readContract({ address: launchpadAddresses.registry, abi: launchpadRegistryAbi, functionName: "launchpadCount" }),
      presetCount: () => client.readContract({ address: launchpadAddresses.configManager, abi: launchpadConfigManagerAbi, functionName: "presetCount" }),
      globalMaximumTotalTradeFeeBps: async () => Number(await client.readContract({ address: launchpadAddresses.configManager, abi: launchpadConfigManagerAbi, functionName: "globalMaximumTotalTradeFeeBps" })),
      destinationSupported: (destination) => client.readContract({ address: launchpadAddresses.configManager, abi: launchpadConfigManagerAbi, functionName: "destinationSupported", args: [destination] }),
      presets: async (ids) => (await client.readContract({ address: launchpadAddresses.configManager, abi: launchpadConfigManagerAbi, functionName: "presets", args: [[...ids]] })).map((item) => ({ ...item })),
      launchpad: async (id) => ({ ...(await client.readContract({ address: launchpadAddresses.registry, abi: launchpadRegistryAbi, functionName: "launchpad", args: [id] })) }),
      launchpads: async (ids) => (await client.readContract({ address: launchpadAddresses.registry, abi: launchpadRegistryAbi, functionName: "launchpads", args: [[...ids]] })).map((item) => ({ ...item })),
    },
    {
      dammGraduation: false,
      dlmmGraduation: false,
    },
  );
  const launchpadReadService = new LaunchpadReadService(
    "testnet",
    CHAIN_ID,
    new PostgresLaunchpadReadStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    dbcService,
    () => client.getBlockNumber(),
  );
  const launchpadBrandingService = new LaunchpadBrandingService(
    CHAIN_ID,
    new PostgresLaunchpadBrandingStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    {
      launchpad: async (launchpadId) => {
        const record = await client.readContract({
          address: launchpadAddresses.registry,
          abi: launchpadRegistryAbi,
          functionName: "launchpad",
          args: [launchpadId],
        });
        return { owner: record.owner, metadataHash: record.metadataHash };
      },
    },
  );

  return {
    config: {
      environment: descriptor.environment,
      chainId: descriptor.chainId,
      chainName: descriptor.name,
      explorerUrl: descriptor.explorerUrl ?? "",
      webOrigin: input.webOrigin,
      contracts: publicContracts(manifest),
    },
    dependencies: {
      dbcService,
      launchpadCatalogService,
      launchpadReadService,
      launchpadBrandingService,
    },
  };
}
