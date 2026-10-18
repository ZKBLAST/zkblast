import { randomBytes, webcrypto } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: {
    compiler?: { version?: string };
    settings?: { optimizer?: { runs?: number } };
  };
}>;
type Tx = ReturnType<typeof record>;
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const out = path.resolve(directory, "../out");
const publicPath = path.join(root, "deployments/testnet/shielded-vault.json");
const privatePath = path.join(
  root,
  "deployments/testnet/shielded-vault.private.json",
);
const manifestPath = path.join(root, "deployments/testnet/manifest.json");
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_VERSION = 1;
const EMPTY_LEAF = 1n;
const DENOMINATION = 10n ** 18n;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function key(name: string): Hex {
  const value = required(name);
  assert(/^0x[\da-f]{64}$/iu.test(value), `${name} is invalid`);
  return value as Hex;
}
async function artifact(source: string, contract: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(path.join(out, `${source}.sol`, `${contract}.json`), "utf8"),
  ) as Artifact;
}
function record(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress
      ? getAddress(receipt.contractAddress)
      : null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success" as const,
  };
}

assert(required("APP_ENV") === "testnet", "Vault deployment is testnet-only");
const chainId = Number(required("CHAIN_ID"));
const rpcUrl = required("RPC_URL");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
const governance = privateKeyToAccount(key("GOVERNANCE_PRIVATE_KEY"));
const protocol = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
  string,
  any
>;
const market = JSON.parse(
  await readFile(path.join(root, "deployments/testnet/market.json"), "utf8"),
) as {
  tokens: Array<{
    address: Address;
    name: string;
    symbol: string;
    decimals: number;
  }>;
};
assert(protocol.chainId === chainId, "Protocol manifest chain mismatch");
assert(
  getAddress(protocol.governanceAddress) === governance.address,
  "GOVERNANCE_PRIVATE_KEY does not match governance",
);
const upgrader = getAddress(required("PROXY_ADMIN_ADDRESS"));
const asset =
  market.tokens.find((token) => token.symbol === "ZKTB") ?? market.tokens[0];
assert(
  asset && asset.decimals === 18,
  "A reviewed 18-decimal testnet asset is required",
);
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const deployerWallet = createWalletClient({
  account: deployer,
  chain,
  transport: http(rpcUrl),
});
const governanceWallet = createWalletClient({
  account: governance,
  chain,
  transport: http(rpcUrl),
});
assert((await client.getChainId()) === chainId, "RPC chain mismatch");
const transactions: Record<string, Tx> = {};
async function wait(label: string, hash: Hash): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  assert(receipt.status === "success", `${label} reverted`);
  transactions[label] = record(receipt);
  return receipt;
}
async function deploy(
  label: string,
  value: Artifact,
  args: readonly unknown[] = [],
): Promise<Address> {
  const receipt = await wait(
    label,
    await deployerWallet.deployContract({
      abi: value.abi,
      bytecode: value.bytecode.object,
      args,
      account: deployer,
    }),
  );
  assert(receipt.contractAddress, `${label} address missing`);
  return getAddress(receipt.contractAddress);
}
async function governanceWrite(
  label: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: governance,
  });
  return wait(label, await governanceWallet.writeContract(request));
}
async function deployerWrite(
  label: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await client.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: deployer,
  });
  return wait(label, await deployerWallet.writeContract(request));
}

const proxyArtifact = await artifact("ERC1967Proxy", "ERC1967Proxy");
const hasherArtifact = await artifact(
  "Poseidon2FieldHasher",
  "Poseidon2FieldHasher",
);
const registryArtifact = await artifact(
  "ShieldedStateRegistry",
  "ShieldedStateRegistry",
);
const vaultArtifact = await artifact("ZKBlastVault", "ZKBlastVault");
const tokenArtifact = await artifact(
  "ZkblastTestnetToken",
  "ZkblastTestnetToken",
);
const hasher = await deploy("deployPoseidon2FieldHasher", hasherArtifact);
const registryImplementation = await deploy(
  "deployShieldedStateRegistryImplementation",
  registryArtifact,
);
const registryInitializer = encodeFunctionData({
  abi: registryArtifact.abi,
  functionName: "initialize",
  args: [governance.address, upgrader],
});
const registry = await deploy(
  "deployShieldedStateRegistryProxy",
  proxyArtifact,
  [registryImplementation, registryInitializer],
);
const vaultImplementation = await deploy(
  "deployZKBlastVaultImplementation",
  vaultArtifact,
);
const vaultInitializer = encodeFunctionData({
  abi: vaultArtifact.abi,
  functionName: "initialize",
  args: [
    governance.address,
    upgrader,
    registry,
    hasher,
    `0x${EMPTY_LEAF.toString(16).padStart(64, "0")}`,
    TREE_VERSION,
  ],
});
const vault = await deploy("deployZKBlastVaultProxy", proxyArtifact, [
  vaultImplementation,
  vaultInitializer,
]);
await governanceWrite(
  "authorizeVault",
  registry,
  registryArtifact.abi,
  "setVaultAuthorization",
  [vault, true],
);
await governanceWrite(
  "configureAsset",
  vault,
  vaultArtifact.abi,
  "setAssetConfig",
  [asset.address, DENOMINATION, true],
);

const secret =
  (BigInt(`0x${randomBytes(31).toString("hex")}`) % (FIELD - 1n)) + 1n;
const nonce =
  (BigInt(`0x${randomBytes(16).toString("hex")}`) % (FIELD - 1n)) + 1n;
const calculatorModule = (await import(
  pathToFileURL(
    path.join(
      root,
      "packages/circuits/target/v1-vector/vector-generator_js/witness_calculator.js",
    ),
  ).href
)) as {
  default: (
    wasm: Uint8Array,
  ) => Promise<{
    calculateWitness(input: unknown, sanityCheck: number): Promise<bigint[]>;
  }>;
};
const calculator = await calculatorModule.default(
  await readFile(
    path.join(
      root,
      "packages/circuits/target/v1-vector/vector-generator_js/vector-generator.wasm",
    ),
  ),
);
const witness = await calculator.calculateWitness(
  {
    chain_id: String(chainId),
    vault_address: BigInt(vault).toString(),
    asset_address: BigInt(asset.address).toString(),
    amount: DENOMINATION.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    path_siblings: Array(32).fill("0"),
    path_directions: Array(32).fill("0"),
  },
  0,
);
const commitment = `0x${witness[1]!.toString(16).padStart(64, "0")}` as Hex;
await deployerWrite(
  "approveExactDeposit",
  asset.address,
  tokenArtifact.abi,
  "approve",
  [vault, DENOMINATION],
);
const depositReceipt = await deployerWrite(
  "depositE2E",
  vault,
  vaultArtifact.abi,
  "deposit",
  [asset.address, DENOMINATION, commitment],
);
const deposited = depositReceipt.logs.flatMap((log) => {
  if (log.address.toLowerCase() !== vault.toLowerCase()) return [];
  try {
    return [
      decodeEventLog({
        abi: vaultArtifact.abi,
        eventName: "CommitmentDeposited",
        data: log.data,
        topics: log.topics,
      }),
    ];
  } catch {
    return [];
  }
})[0];
assert(deposited, "CommitmentDeposited event missing");
const eventArgs = deposited.args as unknown as {
  commitment: Hex;
  leafIndex: number;
  root: Hex;
};
assert(
  eventArgs.commitment.toLowerCase() === commitment.toLowerCase(),
  "Commitment mismatch",
);
assert(
  (await client.readContract({
    address: registry,
    abi: registryArtifact.abi,
    functionName: "isKnownRoot",
    args: [vault, TREE_VERSION, eventArgs.root],
  })) === true,
  "Root was not registered",
);

const passphrase = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const iv = randomBytes(12);
const note = {
  format: "zkblast-note",
  version: 1,
  environment: "testnet",
  chainId,
  vaultAddress: vault,
  treeVersion: TREE_VERSION,
  assetAddress: getAddress(asset.address),
  amountRaw: DENOMINATION.toString(),
  secret: secret.toString(),
  nonce: nonce.toString(),
  commitment: BigInt(commitment).toString(),
  leafIndex: Number(eventArgs.leafIndex),
  transactionHash: depositReceipt.transactionHash,
  createdAt: new Date().toISOString(),
  status: "unspent",
};
const header = `zkblast-note-backup:1:testnet:${chainId}`;
const encryptionKey = await webcrypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
  await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  ),
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"],
);
const ciphertext = await webcrypto.subtle.encrypt(
  { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(header) },
  encryptionKey,
  new TextEncoder().encode(JSON.stringify([note])),
);
await mkdir(path.dirname(privatePath), { recursive: true });
await writeFile(
  privatePath,
  `${JSON.stringify({ warning: "PRIVATE RECOVERY MATERIAL - NEVER COMMIT", passphrase, backup: { format: "zkblast-note-backup", version: 1, environment: "testnet", chainId, salt: salt.toString("base64"), iv: iv.toString("base64"), ciphertext: Buffer.from(ciphertext).toString("base64") } }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(privatePath, 0o600);

const compiler = (value: Artifact) => ({
  version: value.metadata.compiler?.version ?? "0.8.26",
  optimizer: true,
  optimizerRuns: value.metadata.settings?.optimizer?.runs ?? 200,
});
const contractRecord = (
  name: string,
  value: Artifact,
  implementation: Address,
  proxy: Address | null,
  initializer: Hex | null,
  initializerArguments: readonly unknown[],
  txLabels: readonly string[],
) => ({
  contractName: name,
  proxyKind: proxy ? "uups" : "none",
  proxyAddress: proxy,
  implementationAddress: implementation,
  deployerAddress: deployer.address,
  governanceAddress: proxy ? governance.address : null,
  upgraderAddress: proxy ? upgrader : null,
  artifactBytecodeHash: keccak256(value.deployedBytecode.object),
  deployedRuntimeBytecodeHash: keccak256(awaitableCode.get(implementation)!),
  initializerCalldataHash: initializer ? keccak256(initializer) : null,
  initializerArguments,
  transactions: {
    implementationDeployment: transactions[txLabels[0]!]!,
    proxyDeploymentAndInitialization: proxy
      ? transactions[txLabels[1]!]!
      : null,
    configuration: txLabels
      .slice(proxy ? 2 : 1)
      .map((label) => transactions[label]!),
  },
  upgrades: [],
  compiler: compiler(value),
  verification: {
    implementation: "pending",
    proxy: proxy ? "pending" : "not_applicable",
    urls: [
      `${explorerUrl}/address/${implementation}`,
      ...(proxy ? [`${explorerUrl}/address/${proxy}`] : []),
    ],
  },
});
const awaitableCode = new Map<Address, Hex>();
for (const address of [hasher, registryImplementation, vaultImplementation]) {
  const code = await client.getBytecode({ address });
  assert(code, `Runtime bytecode missing at ${address}`);
  awaitableCode.set(address, code);
}
protocol.contracts.Poseidon2FieldHasher = contractRecord(
  "Poseidon2FieldHasher",
  hasherArtifact,
  hasher,
  null,
  null,
  [],
  ["deployPoseidon2FieldHasher"],
);
protocol.contracts.ShieldedStateRegistry = contractRecord(
  "ShieldedStateRegistry",
  registryArtifact,
  registryImplementation,
  registry,
  registryInitializer,
  [governance.address, upgrader],
  [
    "deployShieldedStateRegistryImplementation",
    "deployShieldedStateRegistryProxy",
    "authorizeVault",
  ],
);
protocol.contracts.ZKBlastVault = contractRecord(
  "ZKBlastVault",
  vaultArtifact,
  vaultImplementation,
  vault,
  vaultInitializer,
  [
    governance.address,
    upgrader,
    registry,
    hasher,
    `0x${EMPTY_LEAF.toString(16).padStart(64, "0")}`,
    TREE_VERSION,
  ],
  [
    "deployZKBlastVaultImplementation",
    "deployZKBlastVaultProxy",
    "configureAsset",
    "approveExactDeposit",
    "depositE2E",
  ],
);
protocol.shielded = {
  vault,
  stateRegistry: registry,
  fieldHasher: hasher,
  treeVersion: TREE_VERSION,
  deploymentBlock: transactions.deployPoseidon2FieldHasher!.blockNumber,
  assets: [
    {
      address: getAddress(asset.address),
      symbol: asset.symbol,
      decimals: asset.decimals,
      denominationRaw: DENOMINATION.toString(),
    },
  ],
};
protocol.generatedAt = new Date().toISOString();
const newTransactions = Object.values(transactions);
protocol.totals = {
  transactionCount: protocol.totals.transactionCount + newTransactions.length,
  gasUsed: (
    BigInt(protocol.totals.gasUsed) +
    newTransactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n)
  ).toString(),
  totalFeeWei: (
    BigInt(protocol.totals.totalFeeWei) +
    newTransactions.reduce((sum, tx) => sum + BigInt(tx.totalFeeWei), 0n)
  ).toString(),
};
const publicArtifact = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  generatedAt: protocol.generatedAt,
  contracts: {
    fieldHasher: hasher,
    stateRegistry: registry,
    vault,
    vaultImplementation,
  },
  asset: protocol.shielded.assets[0],
  treeVersion: TREE_VERSION,
  acceptance: {
    commitment,
    leafIndex: Number(eventArgs.leafIndex),
    root: eventArgs.root,
    rootRegistered: true,
    encryptedBackupCreated: true,
  },
  transactions,
  totals: {
    transactionCount: newTransactions.length,
    gasUsed: newTransactions
      .reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n)
      .toString(),
    totalFeeWei: newTransactions
      .reduce((sum, tx) => sum + BigInt(tx.totalFeeWei), 0n)
      .toString(),
  },
  verification: {
    status: "pending",
    urls: [
      `${explorerUrl}/address/${hasher}`,
      `${explorerUrl}/address/${registry}`,
      `${explorerUrl}/address/${vault}`,
    ],
  },
};
for (const [target, value] of [
  [`${manifestPath}.tmp`, protocol],
  [`${publicPath}.tmp`, publicArtifact],
] as const)
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
await rename(`${manifestPath}.tmp`, manifestPath);
await rename(`${publicPath}.tmp`, publicPath);
process.stdout.write(
  `${JSON.stringify({ status: "success", vault, stateRegistry: registry, fieldHasher: hasher, depositTransaction: depositReceipt.transactionHash, privateRecoveryFile: path.relative(root, privatePath) }, null, 2)}\n`,
);
