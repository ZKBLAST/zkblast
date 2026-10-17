import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: unknown;
}>;
type ReceiptRecord = Readonly<{ hash: Hash; contractAddress: Address | null }>;
type ContractRecord = Readonly<{
  contractName: string;
  proxyKind: "uups" | "none";
  proxyAddress: Address | null;
  implementationAddress: Address;
  initializerArguments: readonly unknown[];
  artifactBytecodeHash: Hash;
  deployedRuntimeBytecodeHash: Hash;
  transactions: {
    implementationDeployment: ReceiptRecord;
    proxyDeploymentAndInitialization: ReceiptRecord | null;
  };
  upgrades?: readonly Readonly<{
    newImplementationAddress: Address;
    implementationDeployment: ReceiptRecord;
  }>[];
  verification: { implementation: string; proxy: string };
}>;

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const artifacts = path.resolve(directory, "../out");
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function loadArtifact(name: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(path.join(artifacts, `${name}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
}

const environment = required("APP_ENV");
assert(
  environment === "testnet" || environment === "mainnet",
  "Invalid environment",
);
const chainId = Number(required("CHAIN_ID"));
const manifestPath = path.resolve(root, required("DEPLOYMENT_MANIFEST_PATH"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  protocol: string;
  environment: string;
  chainId: number;
  contracts: Record<string, ContractRecord>;
};
assert(manifest.protocol === "ZKBLAST", "Protocol identity mismatch");
assert(manifest.environment === environment, "Environment mismatch");
assert(manifest.chainId === chainId, "Chain mismatch");
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [required("RPC_URL")] } },
});
const client = createPublicClient({
  chain,
  transport: http(required("RPC_URL")),
});
const proxyArtifact = await loadArtifact("ERC1967Proxy");
const results: Record<string, unknown> = {};

for (const [name, deployment] of Object.entries(manifest.contracts)) {
  const artifact = await loadArtifact(name);
  const latestUpgrade = deployment.upgrades?.at(-1);
  const currentImplementationDeployment =
    latestUpgrade?.implementationDeployment ??
    deployment.transactions.implementationDeployment;
  const implementationTransaction = await client.getTransaction({
    hash: currentImplementationDeployment.hash,
  });
  const expectedImplementationInput = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
  });
  assert(
    implementationTransaction.input === expectedImplementationInput,
    `${name}: implementation constructor input mismatch`,
  );
  const implementationCode = await client.getBytecode({
    address: getAddress(deployment.implementationAddress),
  });
  assert(implementationCode, `${name}: missing implementation bytecode`);
  assert(
    keccak256(implementationCode) === deployment.deployedRuntimeBytecodeHash,
    `${name}: runtime bytecode mismatch`,
  );
  assert(
    keccak256(artifact.deployedBytecode.object) ===
      deployment.artifactBytecodeHash,
    `${name}: artifact bytecode mismatch`,
  );

  let proxyConstructorArguments: readonly unknown[] = [];
  if (deployment.proxyKind === "uups") {
    const initializer = encodeFunctionData({
      abi: artifact.abi,
      functionName: "initialize",
      args: deployment.initializerArguments,
    });
    const initialImplementation =
      deployment.transactions.implementationDeployment.contractAddress;
    assert(
      initialImplementation,
      `${name}: initial implementation address missing`,
    );
    proxyConstructorArguments = [initialImplementation, initializer];
    const proxyTransactionRecord =
      deployment.transactions.proxyDeploymentAndInitialization;
    assert(proxyTransactionRecord, `${name}: proxy transaction missing`);
    const proxyTransaction = await client.getTransaction({
      hash: proxyTransactionRecord.hash,
    });
    const expectedProxyInput = encodeDeployData({
      abi: proxyArtifact.abi,
      bytecode: proxyArtifact.bytecode.object,
      args: proxyConstructorArguments,
    });
    assert(
      proxyTransaction.input === expectedProxyInput,
      `${name}: proxy constructor input mismatch`,
    );
  }

  results[name] = {
    abiHash: keccak256(stringToHex(JSON.stringify(artifact.abi))),
    metadataHash: keccak256(stringToHex(JSON.stringify(artifact.metadata))),
    implementationConstructorArguments: [],
    proxyConstructorArguments,
    initializerArguments: deployment.initializerArguments,
    creationInputVerified: true,
    runtimeBytecodeVerified: true,
    sourceVerificationDeclared:
      deployment.verification.implementation === "verified" &&
      (deployment.proxyKind === "none" ||
        deployment.verification.proxy === "verified"),
  };
}

const audit = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment,
  chainId,
  generatedAt: new Date().toISOString(),
  contracts: results,
  claims: {
    publicAmmOnly: true,
    zeroKnowledgeCircuitIncluded: false,
    privacyClaimMadeForCurrentDeployment: false,
    statement:
      "Current deployment is the public AMM phase and makes no shielded-transaction claim.",
  },
};
const auditPath = path.resolve(
  root,
  `deployments/${environment}/deployment-audit.json`,
);
await mkdir(path.dirname(auditPath), { recursive: true });
const temporary = `${auditPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(audit, null, 2)}\n`, {
  mode: 0o600,
});
await rename(temporary, auditPath);
console.log(
  `Deployment audit passed: ${Object.keys(results).length} contracts`,
);
console.log(`Audit written: deployments/${environment}/deployment-audit.json`);
