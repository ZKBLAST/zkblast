import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const packageRoot = path.resolve(import.meta.dirname, "..");
const targetRoot = path.join(packageRoot, "target");
const evmRoot = path.join(targetRoot, "evm-benchmark");
const rpcUrl = process.env.BENCHMARK_RPC_URL ?? "http://127.0.0.1:18546";
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const publicClient = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain: foundry,
  transport: http(rpcUrl),
});

async function loadArtifact(source, contract) {
  return JSON.parse(
    await readFile(
      path.join(evmRoot, "out", source, `${contract}.json`),
      "utf8",
    ),
  );
}

async function deploy(artifact) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    account,
    bytecode: artifact.bytecode.object,
    gas: 30_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    address: receipt.contractAddress,
    gasUsed: receipt.gasUsed,
    txHash: hash,
  };
}

function linkArtifact(artifact, addresses) {
  let bytecode = artifact.bytecode.object;
  for (const [source, libraries] of Object.entries(
    artifact.bytecode.linkReferences ?? {},
  )) {
    void source;
    for (const [name, references] of Object.entries(libraries)) {
      const address = addresses[name].slice(2).toLowerCase();
      for (const { start, length } of references) {
        const offset = 2 + start * 2;
        bytecode = `${bytecode.slice(0, offset)}${address.padStart(length * 2, "0")}${bytecode.slice(offset + length * 2)}`;
      }
    }
  }
  return { ...artifact, bytecode: { ...artifact.bytecode, object: bytecode } };
}

function words(buffer) {
  const values = [];
  for (let offset = 0; offset < buffer.length; offset += 32) {
    values.push(`0x${buffer.subarray(offset, offset + 32).toString("hex")}`);
  }
  return values;
}

const relationsLibrary = await deploy(
  await loadArtifact("NoirVerifier.sol", "RelationsLib"),
);
const transcriptLibrary = await deploy(
  await loadArtifact("NoirVerifier.sol", "ZKTranscriptLib"),
);
const noirArtifact = linkArtifact(
  await loadArtifact("NoirVerifier.sol", "HonkVerifier"),
  {
    RelationsLib: relationsLibrary.address,
    ZKTranscriptLib: transcriptLibrary.address,
  },
);
const circomArtifact = await loadArtifact(
  "CircomVerifier.sol",
  "Groth16Verifier",
);
const noirDeployment = await deploy(noirArtifact);
const circomDeployment = await deploy(circomArtifact);
const noirProof = `0x${(await readFile(path.join(targetRoot, "noir/proof-run/proof"))).toString("hex")}`;
const noirPublicInputs = words(
  await readFile(path.join(targetRoot, "noir/proof-run/public_inputs")),
);
const circomProof = JSON.parse(
  await readFile(path.join(targetRoot, "circom/proof.json"), "utf8"),
);
const circomPublic = JSON.parse(
  await readFile(path.join(targetRoot, "circom/public.json"), "utf8"),
);
const circomArgs = [
  [BigInt(circomProof.pi_a[0]), BigInt(circomProof.pi_a[1])],
  [
    [BigInt(circomProof.pi_b[0][1]), BigInt(circomProof.pi_b[0][0])],
    [BigInt(circomProof.pi_b[1][1]), BigInt(circomProof.pi_b[1][0])],
  ],
  [BigInt(circomProof.pi_c[0]), BigInt(circomProof.pi_c[1])],
  circomPublic.map(BigInt),
];
const noirCall = {
  abi: parseAbi(["function verify(bytes, bytes32[]) view returns (bool)"]),
  address: noirDeployment.address,
  functionName: "verify",
  args: [noirProof, noirPublicInputs],
};
const circomCall = {
  abi: circomArtifact.abi,
  address: circomDeployment.address,
  functionName: "verifyProof",
  args: circomArgs,
};
const noirGas = await publicClient.estimateContractGas({
  ...noirCall,
  account,
});
const circomGas = await publicClient.estimateContractGas({
  ...circomCall,
  account,
});
const result = {
  measuredAt: new Date().toISOString(),
  rpc: "local-anvil",
  chainId: await publicClient.getChainId(),
  optimizer: { enabled: true, runs: 200 },
  noirUltraHonk: {
    verifierGas: Number(noirGas),
    valid: await publicClient.readContract(noirCall),
    deploymentGas: Number(noirDeployment.gasUsed),
    deploymentTxHash: noirDeployment.txHash,
  },
  circomGroth16: {
    verifierGas: Number(circomGas),
    valid: await publicClient.readContract(circomCall),
    deploymentGas: Number(circomDeployment.gasUsed),
    deploymentTxHash: circomDeployment.txHash,
  },
};
await writeFile(
  path.join(targetRoot, "evm-gas-results.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
