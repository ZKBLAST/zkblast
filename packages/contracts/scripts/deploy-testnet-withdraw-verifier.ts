import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
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
}>;

type Groth16Proof = Readonly<{
  pi_a: readonly [string, string, string];
  pi_b: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ];
  pi_c: readonly [string, string, string];
}>;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const contractRoot = path.resolve(scriptDirectory, "..");
const circuitTarget = path.join(
  repositoryRoot,
  "packages/circuits/target/v1-withdraw",
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function deploymentKey(): Hex {
  const value = required("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[\da-f]{64}$/iu.test(value)) {
    throw new Error("DEPLOYER_PRIVATE_KEY is invalid");
  }
  return value as Hex;
}

function transactionRecord(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: receipt.status,
  };
}

if (required("APP_ENV") !== "testnet") {
  throw new Error("This deployment runner is testnet-only");
}
const chainId = Number(required("CHAIN_ID"));
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error("CHAIN_ID is invalid");
}
const rpcUrl = required("RPC_URL");
const chainName = required("CHAIN_NAME");
const explorerUrl = required("BLOCK_EXPLORER_URL");
const account = privateKeyToAccount(deploymentKey());
const chain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: `${chainName} Explorer`, url: explorerUrl } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

if ((await publicClient.getChainId()) !== chainId) {
  throw new Error("RPC chain does not match configured CHAIN_ID");
}

const artifactPath = path.join(
  contractRoot,
  "out/ZKBlastWithdrawVerifier.sol/ZKBlastWithdrawVerifier.json",
);
const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
const proof = JSON.parse(
  await readFile(path.join(circuitTarget, "testnet-proof.json"), "utf8"),
) as Groth16Proof;
const publicInputs = JSON.parse(
  await readFile(path.join(circuitTarget, "testnet-public.json"), "utf8"),
) as string[];
const transcript = JSON.parse(
  await readFile(
    path.join(circuitTarget, "ceremony-transcript.testnet.json"),
    "utf8",
  ),
) as {
  environment: string;
  artifacts: Record<string, string>;
  beacon: Record<string, unknown>;
  verification: Record<string, boolean>;
  trustNotice: string;
};
if (transcript.environment !== "testnet" || publicInputs.length !== 13) {
  throw new Error("Invalid testnet ceremony artifacts");
}
if (BigInt(publicInputs[2]!) !== BigInt(chainId)) {
  throw new Error("Proof is not bound to configured testnet chain ID");
}

const deploymentHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  account,
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentHash,
  confirmations: 1,
});
if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) {
  throw new Error(`Verifier deployment failed: ${deploymentHash}`);
}
const verifierAddress = getAddress(deploymentReceipt.contractAddress);
const proofBytes = encodeAbiParameters(
  [
    { type: "uint256[2]" },
    { type: "uint256[2][2]" },
    { type: "uint256[2]" },
  ],
  [
    [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  ],
);
const inputValues = publicInputs.map(BigInt) as unknown as readonly bigint[];
const verifiedByCall = await publicClient.readContract({
  address: verifierAddress,
  abi: artifact.abi,
  functionName: "verify",
  args: [proofBytes, inputValues],
});
if (verifiedByCall !== true) throw new Error("Deployed verifier rejected valid proof");

const verificationData = encodeFunctionData({
  abi: artifact.abi,
  functionName: "verify",
  args: [proofBytes, inputValues],
});
const verificationHash: Hash = await walletClient.sendTransaction({
  account,
  to: verifierAddress,
  data: verificationData,
});
const verificationReceipt = await publicClient.waitForTransactionReceipt({
  hash: verificationHash,
  confirmations: 1,
});
if (verificationReceipt.status !== "success") {
  throw new Error(`On-chain verification transaction failed: ${verificationHash}`);
}

const deployedBytecode = await publicClient.getBytecode({ address: verifierAddress });
if (!deployedBytecode) throw new Error("Verifier runtime bytecode is missing");
const latestBlock = await publicClient.getBlock();
const publicArtifact = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  chainName,
  generatedAt: new Date().toISOString(),
  deployerAddress: account.address,
  verifier: {
    contractName: "ZKBlastWithdrawVerifier",
    circuitId: "ZKBLAST_WITHDRAW",
    circuitVersion: 1,
    address: verifierAddress,
    explorerUrl: `${explorerUrl}/address/${verifierAddress}`,
    creationBytecodeHash: keccak256(artifact.bytecode.object),
    artifactRuntimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
    deployedRuntimeBytecodeHash: keccak256(deployedBytecode),
  },
  ceremony: {
    trustNotice: transcript.trustNotice,
    beacon: transcript.beacon,
    verification: transcript.verification,
    artifacts: transcript.artifacts,
  },
  proof: {
    publicInputCount: publicInputs.length,
    publicInputs,
    proofSha256: createHash("sha256")
      .update(await readFile(path.join(circuitTarget, "testnet-proof.json")))
      .digest("hex"),
    proofBytesKeccak256: keccak256(proofBytes),
    verifiedByEthCall: true,
    verifiedByTransaction: true,
  },
  transactions: {
    deployment: transactionRecord(deploymentReceipt),
    validProofVerification: transactionRecord(verificationReceipt),
  },
  anchor: {
    blockNumber: Number(latestBlock.number),
    blockHash: latestBlock.hash,
  },
  totals: {
    transactionCount: 2,
    gasUsed: (deploymentReceipt.gasUsed + verificationReceipt.gasUsed).toString(),
    totalFeeWei: (
      deploymentReceipt.gasUsed * deploymentReceipt.effectiveGasPrice
      + verificationReceipt.gasUsed * verificationReceipt.effectiveGasPrice
    ).toString(),
  },
};
await writeFile(
  path.join(repositoryRoot, "deployments/testnet/withdraw-verifier.json"),
  `${JSON.stringify(publicArtifact, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ verifierAddress, deploymentHash, verificationHash }, null, 2)}\n`,
);
