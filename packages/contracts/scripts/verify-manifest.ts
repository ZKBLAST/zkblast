import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHash,
  keccak256,
  type Hex,
} from "viem";

const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const environment = required("APP_ENV");
assert(
  environment === "testnet" || environment === "mainnet",
  "APP_ENV is invalid",
);
const chainId = Number(required("CHAIN_ID"));
const chainName = required("CHAIN_NAME");
const rpcUrl = required("RPC_URL");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const relativeManifestPath = required("DEPLOYMENT_MANIFEST_PATH");
assert(
  relativeManifestPath === `deployments/${environment}/manifest.json`,
  "Manifest path does not match environment",
);

const manifest = JSON.parse(
  await readFile(path.resolve(repositoryRoot, relativeManifestPath), "utf8"),
) as Record<string, unknown>;
assert(manifest.schemaVersion === 2, "Unsupported manifest schema");
assert(manifest.protocol === "ZKBLAST", "Protocol identity mismatch");
assert(manifest.environment === environment, "Environment mismatch");
assert(manifest.chainId === chainId, "Chain ID mismatch");
const contracts = manifest.contracts as Record<string, Record<string, unknown>>;
assert(contracts && typeof contracts === "object", "Contracts are missing");
for (const requiredContract of [
  "PoolRegistry",
  "PoolFactory",
  "SwapRouter",
  "PositionManager",
  "PoolQuoter",
]) {
  assert(contracts[requiredContract], `${requiredContract} is missing`);
}

const chain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
assert((await client.getChainId()) === chainId, "RPC chain mismatch");
const manifestTransactions: Record<string, unknown>[] = [];

for (const [name, raw] of Object.entries(contracts)) {
  const implementation = raw.implementationAddress;
  assert(
    typeof implementation === "string" && isAddress(implementation),
    `${name}: invalid implementation`,
  );
  const implementationAddress = getAddress(implementation);
  const code = await client.getBytecode({ address: implementationAddress });
  assert(code && code !== "0x", `${name}: implementation has no code`);
  assert(
    raw.deployedRuntimeBytecodeHash === keccak256(code),
    `${name}: runtime bytecode hash mismatch`,
  );
  const transactions = raw.transactions as Record<string, unknown>;
  assert(
    transactions && typeof transactions === "object",
    `${name}: transactions missing`,
  );
  const implementationTransaction =
    transactions.implementationDeployment as Record<string, unknown>;
  assert(
    typeof implementationTransaction?.hash === "string" &&
      isHash(implementationTransaction.hash),
    `${name}: implementation transaction missing`,
  );

  if (raw.proxyKind === "uups") {
    const proxy = raw.proxyAddress;
    assert(
      typeof proxy === "string" && isAddress(proxy),
      `${name}: invalid proxy`,
    );
    const proxyAddress = getAddress(proxy);
    const proxyCode = await client.getBytecode({ address: proxyAddress });
    assert(proxyCode && proxyCode !== "0x", `${name}: proxy has no code`);
    const stored = await client.getStorageAt({
      address: proxyAddress,
      slot: IMPLEMENTATION_SLOT,
    });
    assert(stored, `${name}: implementation slot empty`);
    const storedAddress = getAddress(`0x${stored.slice(-40)}`);
    assert(
      storedAddress === implementationAddress,
      `${name}: proxy implementation mismatch`,
    );
    const proxyTransaction =
      transactions.proxyDeploymentAndInitialization as Record<string, unknown>;
    assert(
      typeof proxyTransaction?.hash === "string" &&
        isHash(proxyTransaction.hash),
      `${name}: proxy transaction missing`,
    );
  }

  const proxyTransaction =
    transactions.proxyDeploymentAndInitialization as Record<
      string,
      unknown
    > | null;
  const upgrades =
    (raw.upgrades as Record<string, unknown>[] | undefined) ?? [];
  let expectedImplementation =
    implementationTransaction.contractAddress as string;
  const upgradeTransactions: Record<string, unknown>[] = [];
  for (const [index, upgrade] of upgrades.entries()) {
    const implementationDeployment = upgrade.implementationDeployment as Record<
      string,
      unknown
    >;
    const proxyUpgrade = upgrade.proxyUpgrade as Record<string, unknown>;
    assert(
      getAddress(upgrade.previousImplementationAddress as string) ===
        getAddress(expectedImplementation),
      `${name}: upgrade ${index} previous implementation mismatch`,
    );
    assert(
      getAddress(upgrade.newImplementationAddress as string) ===
        getAddress(implementationDeployment.contractAddress as string),
      `${name}: upgrade ${index} deployment address mismatch`,
    );
    expectedImplementation = upgrade.newImplementationAddress as string;
    upgradeTransactions.push(implementationDeployment, proxyUpgrade);
  }
  assert(
    getAddress(expectedImplementation) === implementationAddress,
    `${name}: upgrade history does not resolve to current implementation`,
  );
  for (const transaction of [
    implementationTransaction,
    ...(proxyTransaction ? [proxyTransaction] : []),
    ...((transactions.configuration as Record<string, unknown>[]) ?? []),
    ...upgradeTransactions,
  ]) {
    manifestTransactions.push(transaction);
    const hash = transaction.hash as Hex;
    const receipt = await client.getTransactionReceipt({ hash });
    assert(
      receipt.status === "success",
      `${name}: transaction reverted ${hash}`,
    );
    assert(
      receipt.gasUsed.toString() === transaction.gasUsed,
      `${name}: gas mismatch ${hash}`,
    );
  }
}

const integration = manifest.integration as Record<string, string>;
assert(
  integration && typeof integration === "object",
  "Integration map missing",
);
for (const field of [
  "poolRegistry",
  "poolFactory",
  "swapRouter",
  "positionManager",
  "poolQuoter",
]) {
  assert(
    typeof integration[field] === "string" && isAddress(integration[field]),
    `${field}: invalid integration address`,
  );
}
assert(
  getAddress(integration.poolRegistry!) ===
    getAddress(contracts.PoolRegistry?.proxyAddress as string),
  "PoolRegistry integration mismatch",
);
const integrationContracts = {
  poolFactory: "PoolFactory",
  swapRouter: "SwapRouter",
  positionManager: "PositionManager",
  poolQuoter: "PoolQuoter",
} as const;
for (const [field, contractName] of Object.entries(integrationContracts)) {
  const contract = contracts[contractName];
  assert(contract, `${contractName}: deployment missing`);
  const expected = (contract.proxyAddress ??
    contract.implementationAddress) as string;
  assert(
    getAddress(integration[field]!) === getAddress(expected),
    `${contractName}: integration mismatch`,
  );
}

const roleReaderAbi = [
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;
const registryAddress = getAddress(integration.poolRegistry!);
const factoryAddress = getAddress(integration.poolFactory!);
const factoryRole = await client.readContract({
  address: registryAddress,
  abi: roleReaderAbi,
  functionName: "FACTORY_ROLE",
});
const factoryAuthorized = await client.readContract({
  address: registryAddress,
  abi: roleReaderAbi,
  functionName: "hasRole",
  args: [factoryRole, factoryAddress],
});
assert(factoryAuthorized, "PoolFactory is missing FACTORY_ROLE");

const totals = manifest.totals as Record<string, unknown>;
assert(Number(totals?.transactionCount) > 0, "Transaction total is missing");
assert(
  typeof totals?.gasUsed === "string" && /^\d+$/u.test(totals.gasUsed),
  "Gas total is invalid",
);
assert(
  typeof totals?.totalFeeWei === "string" && /^\d+$/u.test(totals.totalFeeWei),
  "Fee total is invalid",
);
assert(
  Number(totals.transactionCount) === manifestTransactions.length,
  "Transaction count total mismatch",
);
assert(
  totals.gasUsed ===
    manifestTransactions
      .reduce(
        (sum, transaction) => sum + BigInt(transaction.gasUsed as string),
        0n,
      )
      .toString(),
  "Gas total mismatch",
);
assert(
  totals.totalFeeWei ===
    manifestTransactions
      .reduce(
        (sum, transaction) => sum + BigInt(transaction.totalFeeWei as string),
        0n,
      )
      .toString(),
  "Fee total mismatch",
);

async function assertExplorerVerified(address: string, label: string) {
  const endpoint = new URL("/api", explorerUrl);
  endpoint.search = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address,
  }).toString();
  const response = await fetch(endpoint);
  assert(response.ok, `${label}: explorer status request failed`);
  const payload = (await response.json()) as {
    status?: string;
    result?: Array<{ SourceCode?: string }>;
  };
  assert(
    payload.status === "1" && Boolean(payload.result?.[0]?.SourceCode),
    `${label}: source is not verified on explorer`,
  );
}

await Promise.all(
  Object.entries(contracts).flatMap(([name, contract]) => {
    const verification = contract.verification as Record<string, unknown>;
    const checks: Promise<void>[] = [];
    if (verification.implementation === "verified") {
      checks.push(
        assertExplorerVerified(
          contract.implementationAddress as string,
          `${name} implementation`,
        ),
      );
    }
    if (verification.proxy === "verified") {
      checks.push(
        assertExplorerVerified(
          contract.proxyAddress as string,
          `${name} proxy`,
        ),
      );
    }
    return checks;
  }),
);

console.log(`Verified deployment manifest: ${environment} chain ${chainId}`);
console.log(`Verified contracts: ${Object.keys(contracts).length}`);
console.log("Verified explorer sources: 9 addresses");
