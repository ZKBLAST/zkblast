import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeDeployData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { getChainDescriptor } from "@zkblast/config";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: Readonly<{ object: Hex }>;
  deployedBytecode: Readonly<{ object: Hex }>;
  metadata?: string;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const chainId = Number(process.env.CHAIN_ID);
const descriptor = getChainDescriptor(chainId);
if (descriptor.family !== "hyperevm") throw new Error("HYPEREVM_CHAIN_REQUIRED");
if (!process.env.RPC_URL) throw new Error("HYPEREVM_RPC_REQUIRED");
if (process.env.DEPLOYER_PRIVATE_KEY || process.env.GOVERNANCE_PRIVATE_KEY || process.env.UPGRADER_PRIVATE_KEY) {
  throw new Error("HYPEREVM_PREFLIGHT_REFUSES_PRIVATE_KEYS");
}

const address = (name: string): Address => {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return getAddress(value);
};
const optionalAddress = (name: string, fallback: Address): Address => {
  const value = process.env[name];
  return value ? getAddress(value) : fallback;
};
const deployer = address("HYPEREVM_DEPLOYER_ADDRESS");
if (descriptor.environment === "mainnet" && !process.env.GOVERNANCE_MULTISIG_ADDRESS) {
  throw new Error("HYPEREVM_MAINNET_GOVERNANCE_REQUIRED");
}
const roles = {
  deployer,
  governance: optionalAddress("GOVERNANCE_MULTISIG_ADDRESS", deployer),
  keeper: optionalAddress("HYPEREVM_KEEPER_ADDRESS", deployer),
  relayer: optionalAddress("HYPEREVM_RELAYER_ADDRESS", deployer),
  feeRecipient: optionalAddress("HYPEREVM_FEE_RECIPIENT_ADDRESS", deployer),
};

const reserveAsset = address("HYPEREVM_RESERVE_ASSET_ADDRESS");
const canonicalWhype = getAddress("0x5555555555555555555555555555555555555555");
if (reserveAsset !== canonicalWhype) throw new Error("HYPEREVM_RESERVE_ASSET_UNAPPROVED");

const client = createPublicClient({
  transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
const rpcChainId = await client.getChainId();
if (rpcChainId !== chainId) throw new Error("HYPEREVM_RPC_CHAIN_MISMATCH");

const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const [block, nonce, deployerBalance, gasPrice, reserveCode, reserveSymbol, reserveDecimals] =
  await Promise.all([
    client.getBlock(),
    client.getTransactionCount({ address: roles.deployer, blockTag: "pending" }),
    client.getBalance({ address: roles.deployer }),
    client.getGasPrice(),
    client.getCode({ address: reserveAsset }),
    client.readContract({ address: reserveAsset, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: reserveAsset, abi: erc20Abi, functionName: "decimals" }),
  ]);
if (!reserveCode || reserveSymbol !== "WHYPE" || reserveDecimals !== 18) {
  throw new Error("HYPEREVM_RESERVE_ASSET_CONTEXT_INVALID");
}

const artifactNames = [
  "PoolRegistry",
  "PoolFactory",
  "SwapRouter",
  "PositionManager",
  "PoolQuoter",
  "LaunchConfigRegistry",
  "LaunchTokenDeployer",
  "VirtualPoolDeployer",
  "LaunchFactory",
  "LaunchpadRouter",
  "LPAllocationEscrow",
  "GraduationManager",
  "CurveQuoter",
  "DammGraduationAdapter",
  "GraduationAdapterRegistry",
  "LaunchpadRegistry",
  "LaunchpadConfigManager",
  "LaunchpadFactory",
  "LaunchpadFeeController",
  "RevenueSplitter",
  "LaunchpadFeeCollector",
  "LaunchpadTokenFactory",
  "LaunchpadLens",
  "ZKBlastTimelock",
] as const;
async function loadArtifact(name: string): Promise<Artifact> {
  const file = path.join(root, "packages/contracts/out", `${name}.sol`, `${name}.json`);
  const build = JSON.parse(await readFile(file, "utf8")) as Artifact;
  if (build.bytecode.object === "0x" || build.deployedBytecode.object === "0x") {
    throw new Error(`HYPEREVM_ARTIFACT_EMPTY:${name}`);
  }
  return build;
}
const artifacts = Object.fromEntries(
  await Promise.all(
    artifactNames.map(async (name) => {
      const build = await loadArtifact(name);
      return [
        name,
        {
          creationBytecodeHash: keccak256(build.bytecode.object),
          runtimeBytecodeHash: keccak256(build.deployedBytecode.object),
          creationBytecodeBytes: (build.bytecode.object.length - 2) / 2,
          runtimeBytecodeBytes: (build.deployedBytecode.object.length - 2) / 2,
          artifactSha256: createHash("sha256").update(JSON.stringify(build)).digest("hex"),
        },
      ];
    }),
  ),
);
const timelockBuild = await loadArtifact("ZKBlastTimelock");
const minimumDelaySeconds = 300n;
const timelockDeploymentData = encodeDeployData({
  abi: timelockBuild.abi,
  bytecode: timelockBuild.bytecode.object,
  args: [minimumDelaySeconds, roles.governance],
});
const predictedTimelock = getContractAddress({ from: roles.deployer, nonce: BigInt(nonce) });
const configuredUpgrader = process.env.HYPEREVM_UPGRADER_ADDRESS
  ? getAddress(process.env.HYPEREVM_UPGRADER_ADDRESS)
  : predictedTimelock;
const [predictedTimelockCode, timelockEstimatedGas] = await Promise.all([
  client.getCode({ address: predictedTimelock }),
  client.estimateGas({ account: roles.deployer, data: timelockDeploymentData }),
]);
if (predictedTimelockCode && predictedTimelockCode !== "0x") {
  throw new Error("HYPEREVM_PREDICTED_TIMELOCK_ALREADY_USED");
}
if (configuredUpgrader !== predictedTimelock) {
  throw new Error("HYPEREVM_UPGRADER_NONCE_PLAN_MISMATCH");
}

const report = {
  schemaVersion: 1,
  mode: "read-only-preflight",
  generatedAt: new Date().toISOString(),
  chain: {
    chainId,
    slug: descriptor.slug,
    name: descriptor.name,
    environment: descriptor.environment,
    rpcChainId,
    referenceBlock: block.number.toString(),
    referenceBlockHash: block.hash,
    gasPriceWei: gasPrice.toString(),
  },
  roles: { ...roles, upgrader: configuredUpgrader },
  governancePlan: {
    mode:
      descriptor.environment === "testnet"
        ? "single-wallet-testnet-canary"
        : "explicit-mainnet-governance",
    minimumDelaySeconds: minimumDelaySeconds.toString(),
    predictedTimelock,
    deploymentNonce: nonce,
    estimatedGas: timelockEstimatedGas.toString(),
    estimatedFeeWei: (timelockEstimatedGas * gasPrice).toString(),
    estimatedFeeHype: formatEther(timelockEstimatedGas * gasPrice),
    creationBytecodeHash: keccak256(timelockDeploymentData),
  },
  deployer: {
    nonce,
    balanceWei: deployerBalance.toString(),
    balanceHype: formatEther(deployerBalance),
  },
  reserveAsset: {
    address: reserveAsset,
    symbol: reserveSymbol,
    decimals: reserveDecimals,
    runtimeBytecodeHash: keccak256(reserveCode),
  },
  artifacts,
  gates: {
    privateKeysRead: false,
    broadcastAllowed: false,
    capabilityEnabled: false,
    graduationAdapterApproved: false,
    exactGasEstimateReady: false,
  },
  nextRequired: [
    "complete the deployment transaction plan and initializer simulation",
    `approve the chain-${chainId} governance and graduation adapter configuration`,
    "report exact gas and maximum spend before broadcast",
    "obtain explicit broadcast approval",
  ],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const target = path.join(root, `deployments/${descriptor.slug}/preflight.json`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, serialized, { mode: 0o644 });
console.log(
  JSON.stringify(
    {
      chainId,
      referenceBlock: report.chain.referenceBlock,
      deployer: roles.deployer,
      nonce,
      balanceHype: report.deployer.balanceHype,
      reserveAsset,
      artifactCount: artifactNames.length,
      predictedTimelock,
      timelockEstimatedGas: timelockEstimatedGas.toString(),
      timelockEstimatedFeeHype: formatEther(timelockEstimatedGas * gasPrice),
      reportSha256: createHash("sha256").update(serialized).digest("hex"),
      report: path.relative(root, target),
      broadcastAllowed: false,
    },
    null,
    2,
  ),
);
