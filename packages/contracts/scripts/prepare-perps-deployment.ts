import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const artifactRoot = path.join(root, "packages/contracts/out");
const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet") throw new Error("PERPS_ENV_INVALID");
const expectedChainId = environment === "mainnet" ? 4663 : 46630;
if (Number(process.env.CHAIN_ID) !== expectedChainId || !process.env.RPC_URL) {
  throw new Error("PERPS_NETWORK_CONFIG_INVALID");
}
if (!process.env.EXECUTION_USDG_ADDRESS) throw new Error("PERPS_COLLATERAL_REQUIRED");
const collateral = getAddress(process.env.EXECUTION_USDG_ADDRESS);
const manifest = JSON.parse(
  await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8"),
) as {
  chainId: number;
  deployerAddress: Address;
  roles: { defaultAdmin: Address; upgrader: Address };
  shieldedV2?: { vault: Address; treeVersion: number };
};
if (manifest.chainId !== expectedChainId || !manifest.shieldedV2?.vault) {
  throw new Error("PERPS_DEPLOYMENT_CONTEXT_INVALID");
}
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
if (await client.getChainId() !== expectedChainId) throw new Error("PERPS_RPC_CHAIN_MISMATCH");
const [collateralCode, custodyCode] = await Promise.all([
  client.getCode({ address: collateral }),
  client.getCode({ address: manifest.shieldedV2.vault }),
]);
if (!collateralCode || !custodyCode) throw new Error("PERPS_DEPENDENCY_CODE_MISSING");

async function artifact(source: string, name = source): Promise<Artifact> {
  const parsed = JSON.parse(
    await readFile(path.join(artifactRoot, `${source}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
  if (parsed.bytecode.object === "0x" || parsed.deployedBytecode.object === "0x") {
    throw new Error(`PERPS_ARTIFACT_MISSING_${name}`);
  }
  return parsed;
}

const deployer = getAddress(manifest.deployerAddress);
const admin = getAddress(manifest.roles.defaultAdmin);
const upgrader = getAddress(manifest.roles.upgrader);
const startingNonce = await client.getTransactionCount({ address: deployer, blockTag: "pending" });
const order = [
  "OpenGroth16", "CloseGroth16", "ModifyGroth16", "ClaimGroth16",
  "PrivatePerpOpenVerifier", "PrivatePerpCloseVerifier", "PrivatePerpModifyVerifier", "PrivatePerpClaimVerifier",
  "PerpMarketRegistryImplementation", "PerpMarketRegistryProxy",
  "ChainlinkOracleAdapterImplementation", "ChainlinkOracleAdapterProxy",
  "FundingRateModuleImplementation", "FundingRateModuleProxy",
  "PerpEngineImplementation", "PerpEngineProxy",
  "InsuranceFundImplementation", "InsuranceFundProxy",
  "LiquidityVaultUSDGImplementation", "LiquidityVaultUSDGProxy",
  "ShieldedPerpAdapterImplementation", "ShieldedPerpAdapterProxy",
] as const;
const addresses = Object.fromEntries(order.map((name, offset) => [
  name,
  getContractAddress({ from: deployer, nonce: BigInt(startingNonce + offset) }),
])) as Record<(typeof order)[number], Address>;

const artifactSpecs = {
  OpenGroth16: await artifact("OpenGroth16"),
  CloseGroth16: await artifact("CloseGroth16"),
  ModifyGroth16: await artifact("ModifyGroth16"),
  ClaimGroth16: await artifact("ClaimGroth16"),
  PrivatePerpOpenVerifier: await artifact("PrivatePerpProofVerifiers", "PrivatePerpOpenVerifier"),
  PrivatePerpCloseVerifier: await artifact("PrivatePerpProofVerifiers", "PrivatePerpCloseVerifier"),
  PrivatePerpModifyVerifier: await artifact("PrivatePerpProofVerifiers", "PrivatePerpModifyVerifier"),
  PrivatePerpClaimVerifier: await artifact("PrivatePerpProofVerifiers", "PrivatePerpClaimVerifier"),
  PerpMarketRegistry: await artifact("PerpMarketRegistry"),
  ChainlinkOracleAdapter: await artifact("ChainlinkOracleAdapter"),
  FundingRateModule: await artifact("FundingRateModule"),
  PerpEngine: await artifact("PerpEngine"),
  InsuranceFund: await artifact("InsuranceFund"),
  LiquidityVaultUSDG: await artifact("LiquidityVaultUSDG"),
  ShieldedPerpAdapter: await artifact("ShieldedPerpAdapter"),
  ERC1967Proxy: await artifact("ERC1967Proxy"),
};
const initializer = (name: keyof typeof artifactSpecs, args: readonly unknown[]) =>
  encodeFunctionData({ abi: artifactSpecs[name].abi, functionName: "initialize", args });
const initializers = {
  PerpMarketRegistry: initializer("PerpMarketRegistry", [admin, upgrader, admin]),
  ChainlinkOracleAdapter: initializer("ChainlinkOracleAdapter", [admin, upgrader, admin]),
  FundingRateModule: initializer("FundingRateModule", [admin, upgrader, admin]),
  PerpEngine: initializer("PerpEngine", [
    admin, upgrader, admin, addresses.LiquidityVaultUSDGProxy,
    addresses.PerpMarketRegistryProxy, addresses.ChainlinkOracleAdapterProxy,
    addresses.FundingRateModuleProxy,
  ]),
  InsuranceFund: initializer("InsuranceFund", [
    admin, upgrader, addresses.LiquidityVaultUSDGProxy, collateral,
  ]),
  LiquidityVaultUSDG: initializer("LiquidityVaultUSDG", [
    admin, upgrader, admin, collateral, addresses.PerpEngineProxy,
    addresses.InsuranceFundProxy, 5_000_000n, 300n, 5_000,
  ]),
  ShieldedPerpAdapter: initializer("ShieldedPerpAdapter", [
    admin, upgrader, collateral, addresses.LiquidityVaultUSDGProxy,
    manifest.shieldedV2.vault, addresses.PrivatePerpOpenVerifier,
    addresses.PrivatePerpCloseVerifier, addresses.PrivatePerpModifyVerifier,
    addresses.PrivatePerpClaimVerifier,
  ]),
};
const setup = JSON.parse(
  await readFile(path.join(root, "packages/circuits/target/perps-v1-candidate-5/setup-report.json"), "utf8"),
);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceArtifacts = Object.fromEntries(Object.entries(artifactSpecs).map(([name, value]) => [name, {
  creationBytecodeHash: keccak256(value.bytecode.object),
  runtimeBytecodeHash: keccak256(value.deployedBytecode.object),
}]));
const latest = await client.getBlock();
const plan = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  feature: "perps-v1",
  environment,
  chainId: expectedChainId,
  referenceBlock: latest.number.toString(),
  referenceBlockHash: latest.hash,
  deployer,
  startingNonce,
  transactionCount: order.length,
  order,
  addresses,
  dependencies: { collateral, privateVaultV2: manifest.shieldedV2.vault, treeVersion: manifest.shieldedV2.treeVersion },
  governance: { admin, upgrader },
  limits: {
    depositCeilingRaw: "5000000",
    withdrawalCooldownSeconds: 300,
    insuranceFeeShareBps: 5000,
    initiallyPaused: true,
  },
  initializerCalldataHashes: Object.fromEntries(
    Object.entries(initializers).map(([name, data]) => [name, keccak256(data)]),
  ),
  sourceArtifacts,
  circuitSetup: setup,
  requiredPostDeployment: [
    "verify all runtime bytecode and proxy implementation slots",
    "authorize ShieldedPerpAdapter on PrivateVaultV2",
    "configure independent oracle feeds and only then register markets",
    "fund insurance and LP vault within the approved cap",
    "keep deposits and positions paused until acceptance",
  ],
  authorization: { broadcastAllowed: false, activeManifestChanged: false },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(root, `deployments/${environment}/perps-v1-plan.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serialized);
console.log(JSON.stringify({
  environment,
  chainId: expectedChainId,
  referenceBlock: plan.referenceBlock,
  startingNonce,
  transactionCount: order.length,
  adapter: addresses.ShieldedPerpAdapterProxy,
  planSha256: sha256(Buffer.from(serialized)),
  broadcastAllowed: false,
}));
