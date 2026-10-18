import { webcrypto } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
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
  metadata: { compiler?: { version?: string }; settings?: { optimizer?: { runs?: number } } };
}>;
type Proof = Readonly<{
  pi_a: readonly [string, string, string];
  pi_b: readonly [readonly [string, string], readonly [string, string], readonly [string, string]];
  pi_c: readonly [string, string, string];
}>;
type TxRecord = ReturnType<typeof transactionRecord>;

const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const CIRCUIT_ID = keccak256(bytesToHex(new TextEncoder().encode("ZKBLAST_WITHDRAW")));
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const out = path.join(root, "packages/contracts/out");
const manifestPath = path.join(root, "deployments/testnet/manifest.json");
const vaultDeploymentPath = path.join(root, "deployments/testnet/shielded-vault.json");
const privateNotePath = path.join(root, "deployments/testnet/shielded-vault.private.json");
const verifierDeploymentPath = path.join(root, "deployments/testnet/withdraw-verifier.json");
const outputPath = path.join(root, "deployments/testnet/shielded-withdrawal.json");
const circuitRoot = path.join(root, "packages/circuits/target/v1-withdraw");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function privateKey(name: string): Hex {
  const value = required(name);
  assert(/^0x[\da-f]{64}$/iu.test(value), `${name} is invalid`);
  return value as Hex;
}
async function artifact(source: string, contract = source): Promise<Artifact> {
  return JSON.parse(
    await readFile(path.join(out, `${source}.sol`, `${contract}.json`), "utf8"),
  ) as Artifact;
}
function transactionRecord(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success" as const,
  };
}
async function atomicWrite(file: string, value: unknown, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, file);
}

assert(required("APP_ENV") === "testnet", "Withdrawal deployment is testnet-only");
const chainId = Number(required("CHAIN_ID"));
const rpcUrl = required("RPC_URL");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const deployer = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
const governance = privateKeyToAccount(privateKey("GOVERNANCE_PRIVATE_KEY"));
const upgrader = privateKeyToAccount(privateKey("UPGRADER_PRIVATE_KEY"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as any;
const vaultDeployment = JSON.parse(await readFile(vaultDeploymentPath, "utf8")) as any;
const verifierDeployment = JSON.parse(await readFile(verifierDeploymentPath, "utf8")) as any;
const privateRecovery = JSON.parse(await readFile(privateNotePath, "utf8")) as any;
assert(manifest.chainId === chainId, "Manifest chain mismatch");
assert(getAddress(manifest.deployerAddress) === deployer.address, "Deployer key mismatch");
assert(getAddress(manifest.governanceAddress) === governance.address, "Governance key mismatch");
assert(getAddress(manifest.upgraderAddress) === upgrader.address, "Upgrader key mismatch");
assert(!privateRecovery.spent, "Acceptance note is already marked spent");

const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const deployerWallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const governanceWallet = createWalletClient({ account: governance, chain, transport: http(rpcUrl) });
const upgraderWallet = createWalletClient({ account: upgrader, chain, transport: http(rpcUrl) });
assert((await client.getChainId()) === chainId, "RPC chain mismatch");
const balances = await Promise.all(
  [deployer.address, governance.address, upgrader.address].map((address) =>
    client.getBalance({ address }),
  ),
);
assert(balances.every((balance) => balance > 0n), "A privileged account has zero native balance");

const proxyArtifact = await artifact("ERC1967Proxy");
const verifierRegistryArtifact = await artifact("VerifierRegistry");
const adapterArtifact = await artifact("WithdrawalVerifierAdapter");
const vaultArtifact = await artifact("ZKBlastVault");
const stateRegistryArtifact = await artifact("ShieldedStateRegistry");
const hasherArtifact = await artifact("Poseidon2FieldHasher");
const tokenArtifact = await artifact("ZkblastTestnetToken");
const transactions: Record<string, TxRecord> = {};
function recorded(label: string): TxRecord {
  const transaction = transactions[label];
  assert(transaction, `Transaction record missing: ${label}`);
  return transaction;
}

async function wait(label: string, hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert(receipt.status === "success", `${label} reverted`);
  transactions[label] = transactionRecord(receipt);
  return receipt;
}
async function deploy(label: string, value: Artifact, args: readonly unknown[] = []) {
  const receipt = await wait(
    label,
    await deployerWallet.deployContract({
      account: deployer,
      abi: value.abi,
      bytecode: value.bytecode.object,
      args,
    }),
  );
  assert(receipt.contractAddress, `${label} address missing`);
  return getAddress(receipt.contractAddress);
}
async function write(
  label: string,
  actor: "governance" | "upgrader" | "deployer",
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const account = actor === "governance" ? governance : actor === "upgrader" ? upgrader : deployer;
  const wallet = actor === "governance" ? governanceWallet : actor === "upgrader" ? upgraderWallet : deployerWallet;
  const { request } = await client.simulateContract({
    account,
    address,
    abi,
    functionName,
    args,
  });
  return wait(label, await wallet.writeContract(request));
}

const stateRegistry = getAddress(vaultDeployment.contracts.stateRegistry);
const vault = getAddress(vaultDeployment.contracts.vault);
const hasher = getAddress(vaultDeployment.contracts.fieldHasher);
const asset = getAddress(vaultDeployment.asset.address);
const verifier = getAddress(verifierDeployment.verifier.address);
const oldImplementationStorage = await client.getStorageAt({ address: vault, slot: IMPLEMENTATION_SLOT });
assert(oldImplementationStorage, "Vault implementation slot missing");
const oldImplementation = getAddress(`0x${oldImplementationStorage.slice(-40)}`);
assert(
  oldImplementation === getAddress(vaultDeployment.contracts.vaultImplementation),
  "Unexpected current vault implementation",
);
assert((await client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "nextLeafIndex" })) === 1n, "Acceptance requires exactly one deposited leaf");
assert((await client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "root" })) === vaultDeployment.acceptance.root, "Vault root changed");

const registryImplementation = await deploy("deployVerifierRegistryImplementation", verifierRegistryArtifact);
const registryInitializer = encodeFunctionData({
  abi: verifierRegistryArtifact.abi,
  functionName: "initialize",
  args: [governance.address, upgrader.address],
});
const verifierRegistry = await deploy("deployVerifierRegistryProxy", proxyArtifact, [
  registryImplementation,
  registryInitializer,
]);
const adapter = await deploy("deployWithdrawalVerifierAdapter", adapterArtifact, [
  verifierRegistry,
  stateRegistry,
]);
const newVaultImplementation = await deploy("deployZKBlastVaultImplementation", vaultArtifact);

const circuitHash = keccak256(bytesToHex(await readFile(path.join(circuitRoot, "withdraw.r1cs"))));
const verificationKeyHash = keccak256(
  bytesToHex(await readFile(path.join(circuitRoot, "verification_key.json"))),
);
await write(
  "registerWithdrawVerifier",
  "governance",
  verifierRegistry,
  verifierRegistryArtifact.abi,
  "register",
  [CIRCUIT_ID, 1n, verifier, circuitHash, verificationKeyHash],
);
await write(
  "authorizeWithdrawalAdapter",
  "governance",
  stateRegistry,
  stateRegistryArtifact.abi,
  "setConsumerAuthorization",
  [adapter, true],
);
await write(
  "upgradeVaultImplementation",
  "upgrader",
  vault,
  vaultArtifact.abi,
  "upgradeToAndCall",
  [newVaultImplementation, "0x"],
);
const storedImplementation = await client.getStorageAt({ address: vault, slot: IMPLEMENTATION_SLOT });
assert(
  storedImplementation && getAddress(`0x${storedImplementation.slice(-40)}`) === newVaultImplementation,
  "Vault implementation slot did not update",
);
await write(
  "configureWithdrawalAdapter",
  "governance",
  vault,
  vaultArtifact.abi,
  "setWithdrawalAdapter",
  [adapter],
);

const salt = Uint8Array.from(Buffer.from(privateRecovery.backup.salt, "base64"));
const iv = Uint8Array.from(Buffer.from(privateRecovery.backup.iv, "base64"));
const encryptionKey = await webcrypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
  await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(privateRecovery.passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  ),
  { name: "AES-GCM", length: 256 },
  false,
  ["decrypt"],
);
const plaintext = await webcrypto.subtle.decrypt(
  {
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode(`zkblast-note-backup:1:testnet:${chainId}`),
  },
  encryptionKey,
  Uint8Array.from(Buffer.from(privateRecovery.backup.ciphertext, "base64")),
);
const [note] = JSON.parse(new TextDecoder().decode(plaintext)) as any[];
assert(note && note.commitment === BigInt(vaultDeployment.acceptance.commitment).toString(), "Recovery note does not match acceptance commitment");

const siblings: string[] = [];
let zero = `0x${"0".repeat(63)}1` as Hex;
for (let level = 0; level < 32; level += 1) {
  siblings.push(BigInt(zero).toString());
  zero = await client.readContract({
    address: hasher,
    abi: hasherArtifact.abi,
    functionName: "hashMerkleNode",
    args: [BigInt(level), zero, zero],
  }) as Hex;
}
const merkleRoot = await client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "root" }) as Hex;
const deadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
const vectorCalculatorModule = await import(
  pathToFileURL(
    path.join(root, "packages/circuits/target/v1-vector/vector-generator_js/witness_calculator.js"),
  ).href
);
const vectorCalculator = await vectorCalculatorModule.default(
  await readFile(path.join(root, "packages/circuits/target/v1-vector/vector-generator_js/vector-generator.wasm")),
);
const noteWitness = await vectorCalculator.calculateWitness(
  {
    chain_id: String(chainId),
    vault_address: BigInt(vault).toString(),
    asset_address: BigInt(asset).toString(),
    amount: note.amountRaw,
    secret: note.secret,
    nonce: note.nonce,
    path_siblings: siblings,
    path_directions: Array(32).fill("0"),
  },
  0,
);
assert(noteWitness[2].toString() === BigInt(merkleRoot).toString(), "Recovered note path root mismatch");
const publicInputs = [
  1n,
  1n,
  BigInt(chainId),
  BigInt(vault),
  1n,
  BigInt(merkleRoot),
  noteWitness[3],
  BigInt(asset),
  BigInt(note.amountRaw),
  BigInt(deployer.address),
  BigInt(deployer.address),
  0n,
  deadline,
] as const;
const circuitInput = {
  schema_version: "1",
  action: "1",
  chain_id: String(chainId),
  vault_address: BigInt(vault).toString(),
  tree_version: "1",
  merkle_root: BigInt(merkleRoot).toString(),
  nullifier: noteWitness[3].toString(),
  asset_address: BigInt(asset).toString(),
  amount: note.amountRaw,
  recipient_address: BigInt(deployer.address).toString(),
  relayer_address: BigInt(deployer.address).toString(),
  relayer_fee: "0",
  deadline: deadline.toString(),
  secret: note.secret,
  nonce: note.nonce,
  leaf_index: "0",
  path_siblings: siblings,
  path_directions: Array(32).fill("0"),
};
const snarkjs = await import(
  pathToFileURL(path.join(root, "packages/circuits/node_modules/snarkjs/build/main.cjs")).href
) as any;
const generated = await snarkjs.groth16.fullProve(
  circuitInput,
  path.join(circuitRoot, "withdraw_js/withdraw.wasm"),
  path.join(circuitRoot, "withdraw_v1_final.zkey"),
) as { proof: Proof; publicSignals: string[] };
assert(
  generated.publicSignals.length === 13 &&
    generated.publicSignals.every((value, index) => BigInt(value) === publicInputs[index]),
  "Generated proof public inputs mismatch",
);
const proofBytes = encodeAbiParameters(
  [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
  [
    [BigInt(generated.proof.pi_a[0]), BigInt(generated.proof.pi_a[1])],
    [
      [BigInt(generated.proof.pi_b[0][1]), BigInt(generated.proof.pi_b[0][0])],
      [BigInt(generated.proof.pi_b[1][1]), BigInt(generated.proof.pi_b[1][0])],
    ],
    [BigInt(generated.proof.pi_c[0]), BigInt(generated.proof.pi_c[1])],
  ],
);
const nullifier = `0x${publicInputs[6].toString(16).padStart(64, "0")}` as Hex;
assert(
  !(await client.readContract({
    address: stateRegistry,
    abi: stateRegistryArtifact.abi,
    functionName: "isNullifierSpent",
    args: [vault, 1n, nullifier],
  })),
  "Acceptance nullifier is already spent",
);
const recipientBalanceBefore = await client.readContract({
  address: asset,
  abi: tokenArtifact.abi,
  functionName: "balanceOf",
  args: [deployer.address],
}) as bigint;
const withdrawalReceipt = await write(
  "withdrawAcceptanceNote",
  "deployer",
  vault,
  vaultArtifact.abi,
  "withdraw",
  [proofBytes, publicInputs],
);
const withdrawnEvent = withdrawalReceipt.logs.some((log) => {
  if (log.address.toLowerCase() !== vault.toLowerCase()) return false;
  try {
    const decoded = decodeEventLog({
      abi: vaultArtifact.abi,
      eventName: "NoteWithdrawn",
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as unknown as { nullifier: Hex };
    return args.nullifier.toLowerCase() === nullifier.toLowerCase();
  } catch {
    return false;
  }
});
assert(withdrawnEvent, "NoteWithdrawn event missing");
const [spent, vaultBalance, recipientBalanceAfter] = await Promise.all([
  client.readContract({ address: stateRegistry, abi: stateRegistryArtifact.abi, functionName: "isNullifierSpent", args: [vault, 1n, nullifier] }),
  client.readContract({ address: asset, abi: tokenArtifact.abi, functionName: "balanceOf", args: [vault] }),
  client.readContract({ address: asset, abi: tokenArtifact.abi, functionName: "balanceOf", args: [deployer.address] }),
]);
assert(spent === true, "Nullifier was not consumed");
assert((vaultBalance as bigint) === 0n, "Vault acceptance balance was not withdrawn");
assert((recipientBalanceAfter as bigint) - recipientBalanceBefore === BigInt(note.amountRaw), "Recipient balance delta mismatch");
const withdrawalTransaction = recorded("withdrawAcceptanceNote");

function compiler(value: Artifact) {
  return {
    version: value.metadata.compiler?.version ?? "0.8.26",
    optimizer: true,
    optimizerRuns: value.metadata.settings?.optimizer?.runs ?? 200,
  };
}
async function runtimeHash(address: Address) {
  const code = await client.getBytecode({ address });
  assert(code, `Runtime code missing: ${address}`);
  return keccak256(code);
}
const registryRecord = {
  contractName: "VerifierRegistry",
  proxyKind: "uups",
  proxyAddress: verifierRegistry,
  implementationAddress: registryImplementation,
  deployerAddress: deployer.address,
  governanceAddress: governance.address,
  upgraderAddress: upgrader.address,
  artifactBytecodeHash: keccak256(verifierRegistryArtifact.deployedBytecode.object),
  deployedRuntimeBytecodeHash: await runtimeHash(registryImplementation),
  initializerCalldataHash: keccak256(registryInitializer),
  initializerArguments: [governance.address, upgrader.address],
  transactions: {
    implementationDeployment: transactions.deployVerifierRegistryImplementation,
    proxyDeploymentAndInitialization: transactions.deployVerifierRegistryProxy,
    configuration: [transactions.registerWithdrawVerifier],
  },
  upgrades: [],
  compiler: compiler(verifierRegistryArtifact),
  verification: {
    implementation: "pending",
    proxy: "pending",
    urls: [`${explorerUrl}/address/${registryImplementation}`, `${explorerUrl}/address/${verifierRegistry}`],
  },
};
const adapterRecord = {
  contractName: "WithdrawalVerifierAdapter",
  proxyKind: "none",
  proxyAddress: null,
  implementationAddress: adapter,
  deployerAddress: deployer.address,
  governanceAddress: null,
  upgraderAddress: null,
  artifactBytecodeHash: keccak256(adapterArtifact.deployedBytecode.object),
  deployedRuntimeBytecodeHash: await runtimeHash(adapter),
  initializerCalldataHash: null,
  initializerArguments: [verifierRegistry, stateRegistry],
  transactions: {
    implementationDeployment: transactions.deployWithdrawalVerifierAdapter,
    proxyDeploymentAndInitialization: null,
    configuration: [],
  },
  upgrades: [],
  compiler: compiler(adapterArtifact),
  verification: {
    implementation: "pending",
    proxy: "not_applicable",
    urls: [`${explorerUrl}/address/${adapter}`],
  },
};
manifest.contracts.VerifierRegistry = registryRecord;
manifest.contracts.WithdrawalVerifierAdapter = adapterRecord;
const vaultRecord = manifest.contracts.ZKBlastVault;
vaultRecord.upgrades.push({
  previousImplementationAddress: oldImplementation,
  newImplementationAddress: newVaultImplementation,
  implementationDeployment: transactions.deployZKBlastVaultImplementation,
  proxyUpgrade: transactions.upgradeVaultImplementation,
});
vaultRecord.implementationAddress = newVaultImplementation;
vaultRecord.artifactBytecodeHash = keccak256(vaultArtifact.deployedBytecode.object);
vaultRecord.deployedRuntimeBytecodeHash = await runtimeHash(newVaultImplementation);
vaultRecord.transactions.configuration.push(
  transactions.authorizeWithdrawalAdapter,
  transactions.configureWithdrawalAdapter,
  transactions.withdrawAcceptanceNote,
);
vaultRecord.verification.implementation = "pending";
vaultRecord.verification.proxy = "verified";
vaultRecord.verification.urls.push(`${explorerUrl}/address/${newVaultImplementation}`);
const added = Object.values(transactions);
manifest.generatedAt = new Date().toISOString();
manifest.deploymentBlock = withdrawalTransaction.blockNumber;
manifest.deploymentBlockHash = withdrawalTransaction.blockHash;
manifest.totals.transactionCount += added.length;
manifest.totals.gasUsed = (BigInt(manifest.totals.gasUsed) + added.reduce((sum: bigint, tx: any) => sum + BigInt(tx.gasUsed), 0n)).toString();
manifest.totals.totalFeeWei = (BigInt(manifest.totals.totalFeeWei) + added.reduce((sum: bigint, tx: any) => sum + BigInt(tx.totalFeeWei), 0n)).toString();

const deploymentOutput = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  generatedAt: manifest.generatedAt,
  contracts: {
    verifierRegistry,
    verifierRegistryImplementation: registryImplementation,
    withdrawalAdapter: adapter,
    vault,
    previousVaultImplementation: oldImplementation,
    vaultImplementation: newVaultImplementation,
    withdrawVerifier: verifier,
  },
  circuit: { circuitId: CIRCUIT_ID, version: 1, circuitHash, verificationKeyHash },
  acceptance: {
    commitment: vaultDeployment.acceptance.commitment,
    root: merkleRoot,
    nullifier,
    recipient: deployer.address,
    amountRaw: note.amountRaw,
    nullifierSpent: true,
    vaultBalanceRaw: (vaultBalance as bigint).toString(),
  },
  transactions,
  totals: {
    transactionCount: added.length,
    gasUsed: added.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n).toString(),
    totalFeeWei: added.reduce((sum, tx) => sum + BigInt(tx.totalFeeWei), 0n).toString(),
  },
  verification: { status: "pending", urls: [...registryRecord.verification.urls, ...adapterRecord.verification.urls, `${explorerUrl}/address/${newVaultImplementation}`] },
};
privateRecovery.spent = {
  nullifier,
    transactionHash: withdrawalTransaction.hash,
    blockNumber: withdrawalTransaction.blockNumber,
  spentAt: manifest.generatedAt,
};
await atomicWrite(outputPath, deploymentOutput);
await atomicWrite(manifestPath, manifest);
await atomicWrite(privateNotePath, privateRecovery);
await chmod(privateNotePath, 0o600);
console.log(`Shielded withdrawal deployed and accepted at block ${withdrawalTransaction.blockNumber}`);
console.log(`Verifier registry: ${verifierRegistry}`);
console.log(`Withdrawal adapter: ${adapter}`);
console.log(`Vault implementation: ${newVaultImplementation}`);
console.log(`Withdrawal transaction: ${withdrawalTransaction.hash}`);

