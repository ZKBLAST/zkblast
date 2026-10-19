import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  defineChain,
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
import { privateKeyToAccount } from "viem/accounts";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
}>;

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const artifactRoot = path.resolve(directory, "../out");
const outputPath = path.resolve(root, "deployments/mainnet/deployment-plan.json");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function artifact(name: string): Promise<Artifact> {
  const location = path.resolve(artifactRoot, `${name}.sol/${name}.json`);
  const value = JSON.parse(await readFile(location, "utf8")) as Artifact;
  invariant(value.bytecode.object !== "0x", `${name} creation bytecode missing`);
  invariant(value.deployedBytecode.object !== "0x", `${name} runtime missing`);
  return value;
}

invariant(required("APP_ENV") === "mainnet", "Mainnet environment required");
const chainId = Number(required("CHAIN_ID"));
invariant(chainId === 4663, "Chain 4663 required");
const key = required("DEPLOYER_PRIVATE_KEY") as Hex;
invariant(/^0x[\da-f]{64}$/iu.test(key), "Invalid deployer key");
const deployer = privateKeyToAccount(key).address;
const governance = getAddress(required("GOVERNANCE_MULTISIG_ADDRESS"));
const upgrader = getAddress(required("PROXY_ADMIN_ADDRESS"));
const minimumDelay = BigInt(required("MIN_TIMELOCK_DELAY_SECONDS"));
invariant(minimumDelay === 300n, "Reviewed mainnet delay must be 300 seconds");
const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
invariant((await client.getChainId()) === chainId, "RPC chain mismatch");

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const [owners, threshold, delay] = await Promise.all([
  client.readContract({ address: governance, abi: safeAbi, functionName: "getOwners" }),
  client.readContract({ address: governance, abi: safeAbi, functionName: "getThreshold" }),
  client.readContract({ address: upgrader, abi: timelockAbi, functionName: "getMinDelay" }),
]);
invariant(owners.length >= 2 && threshold >= 2n, "Unsafe governance Safe");
invariant(delay === minimumDelay, "Timelock delay mismatch");
for (const functionName of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"] as const) {
  const role = await client.readContract({ address: upgrader, abi: timelockAbi, functionName });
  invariant(
    await client.readContract({
      address: upgrader,
      abi: timelockAbi,
      functionName: "hasRole",
      args: [role, governance],
    }),
    `Timelock ${functionName} mismatch`,
  );
}

const names = [
  "PoolRegistry",
  "PoolFactory",
  "SwapRouter",
  "PositionManager",
  "PoolQuoter",
] as const;
const artifacts = Object.fromEntries(
  await Promise.all(names.map(async (name) => [name, await artifact(name)] as const)),
) as Record<(typeof names)[number], Artifact>;
const proxyArtifact = await artifact("ERC1967Proxy");
const startingNonce = await client.getTransactionCount({
  address: deployer,
  blockTag: "pending",
});
const atNonce = (offset: number): Address =>
  getContractAddress({ from: deployer, nonce: BigInt(startingNonce + offset) });
const addresses = {
  PoolRegistry: { implementation: atNonce(0), proxy: atNonce(1) },
  PoolFactory: { implementation: atNonce(2), proxy: atNonce(3) },
  SwapRouter: { implementation: atNonce(4), proxy: atNonce(5) },
  PositionManager: { implementation: atNonce(6), proxy: atNonce(7) },
  PoolQuoter: { implementation: atNonce(8), proxy: null },
};
const initializerArgs = {
  PoolRegistry: [governance, upgrader, addresses.PoolFactory.proxy],
  PoolFactory: [governance, upgrader, addresses.PoolRegistry.proxy],
  SwapRouter: [governance, upgrader, addresses.PoolRegistry.proxy],
  PositionManager: [governance, upgrader, addresses.PoolRegistry.proxy],
} as const;
const contracts = Object.fromEntries(
  names.map((name) => {
    const value = artifacts[name];
    const args = name === "PoolQuoter" ? null : initializerArgs[name];
    const initializer = args
      ? encodeFunctionData({ abi: value.abi, functionName: "initialize", args })
      : null;
    return [
      name,
      {
        ...addresses[name],
        creationBytecodeHash: keccak256(value.bytecode.object),
        runtimeBytecodeHash: keccak256(value.deployedBytecode.object),
        initializerArguments: args,
        initializerCalldataHash: initializer ? keccak256(initializer) : null,
      },
    ];
  }),
);
const latestBlock = await client.getBlock();
const plan = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  kind: "predeployment-plan",
  environment: "mainnet",
  chainId,
  generatedAt: new Date().toISOString(),
  referenceBlock: Number(latestBlock.number),
  referenceBlockHash: latestBlock.hash,
  deployerAddress: deployer,
  startingNonce,
  governance: {
    safeAddress: governance,
    owners,
    threshold: threshold.toString(),
    timelockAddress: upgrader,
    timelockDelaySeconds: delay.toString(),
  },
  transactionCount: 9,
  contracts,
  proxy: {
    creationBytecodeHash: keccak256(proxyArtifact.bytecode.object),
    runtimeBytecodeHash: keccak256(proxyArtifact.deployedBytecode.object),
  },
  approval: {
    broadcastApproved: false,
    independentAuditApproved: false,
    note: "This plan is not a live deployment manifest and authorizes no transaction.",
  },
};
await mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);
console.log(`Mainnet deployment plan ready at nonce ${startingNonce}`);
console.log(`Transactions planned: ${plan.transactionCount}`);
console.log(`Plan written: ${path.relative(root, outputPath)}`);
