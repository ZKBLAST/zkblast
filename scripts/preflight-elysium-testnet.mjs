import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ELYSIUM_TESTNET_CHAIN_ID,
  ELYSIUM_TESTNET_GATEWAY,
  ELYSIUM_TESTNET_MULTICALL3,
  elysiumCanonicalAssets,
  getChainDescriptor,
} from "../packages/config/src/index.ts";
import {
  decodeFunctionResult,
  encodeDeployData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
} from "viem";

const erc20MetadataAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const networkOnly = process.argv.includes("--network-only");
const descriptor = getChainDescriptor(ELYSIUM_TESTNET_CHAIN_ID);
const rpcUrl =
  process.env.ELYSIUM_PRIVATE_RPC_URL ?? descriptor.publicRpcUrls[0];
if (!rpcUrl) throw new Error("ELYSIUM_RPC_URL_REQUIRED");

async function rpc(method, params = []) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload.error)
        throw new Error(`ELYSIUM_RPC_ERROR_${payload.error.code}`);
      return payload.result;
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`ELYSIUM_RPC_HTTP_${response.status}`);
    }
    if (attempt === 3) throw new Error(`ELYSIUM_RPC_HTTP_${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error("ELYSIUM_RPC_RETRY_EXHAUSTED");
}

function requiredAddress(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return getAddress(value);
}

const chainId = Number(BigInt(await rpc("eth_chainId")));
if (chainId !== ELYSIUM_TESTNET_CHAIN_ID) {
  throw new Error(`ELYSIUM_CHAIN_MISMATCH:${chainId}`);
}

const canonicalContracts = [
  ...elysiumCanonicalAssets.map((asset) => ({
    name: asset.symbol,
    address: asset.address,
    kind: "contract",
  })),
  {
    name: "Multicall3",
    address: ELYSIUM_TESTNET_MULTICALL3,
    kind: "contract",
  },
  {
    name: "Gateway",
    address: ELYSIUM_TESTNET_GATEWAY,
    kind: "protocol-endpoint",
  },
];
const codeChecks = [];
for (const contract of canonicalContracts) {
  const code = await rpc("eth_getCode", [contract.address, "latest"]);
  if (
    contract.kind === "contract" &&
    (typeof code !== "string" || code === "0x")
  ) {
    throw new Error(`ELYSIUM_CANONICAL_CODE_MISSING:${contract.name}`);
  }
  const hasRuntimeCode = typeof code === "string" && code !== "0x";
  let tokenMetadata = null;
  const asset = elysiumCanonicalAssets.find(
    (candidate) => candidate.address.toLowerCase() === contract.address.toLowerCase(),
  );
  if (asset) {
    const [symbolResult, decimalsResult, totalSupplyResult] = await Promise.all([
      rpc("eth_call", [{ to: contract.address, data: "0x95d89b41" }, "latest"]),
      rpc("eth_call", [{ to: contract.address, data: "0x313ce567" }, "latest"]),
      rpc("eth_call", [{ to: contract.address, data: "0x18160ddd" }, "latest"]),
    ]);
    const symbol = decodeFunctionResult({
      abi: erc20MetadataAbi,
      functionName: "symbol",
      data: symbolResult,
    });
    const decimals = decodeFunctionResult({
      abi: erc20MetadataAbi,
      functionName: "decimals",
      data: decimalsResult,
    });
    const totalSupply = decodeFunctionResult({
      abi: erc20MetadataAbi,
      functionName: "totalSupply",
      data: totalSupplyResult,
    });
    if (symbol !== asset.symbol || decimals !== asset.decimals) {
      throw new Error(`ELYSIUM_CANONICAL_METADATA_MISMATCH:${contract.name}`);
    }
    tokenMetadata = {
      symbol,
      decimals,
      totalSupplyRaw: totalSupply.toString(),
    };
  }
  codeChecks.push({
    ...contract,
    hasRuntimeCode,
    runtimeBytes: hasRuntimeCode ? (code.length - 2) / 2 : 0,
    runtimeSha256: hasRuntimeCode
      ? createHash("sha256")
          .update(Buffer.from(code.slice(2), "hex"))
          .digest("hex")
      : null,
    tokenMetadata,
  });
}

const blockNumberHex = await rpc("eth_blockNumber");
const [block, gasPriceHex] = await Promise.all([
  rpc("eth_getBlockByNumber", [blockNumberHex, false]),
  rpc("eth_gasPrice"),
]);

const roles = networkOnly
  ? null
  : {
      deployer: requiredAddress("ELYSIUM_DEPLOYER_ADDRESS"),
      governance: requiredAddress("ELYSIUM_GOVERNANCE_ADDRESS"),
      upgrader: process.env.ELYSIUM_UPGRADER_ADDRESS
        ? getAddress(process.env.ELYSIUM_UPGRADER_ADDRESS)
        : null,
      pauser: requiredAddress("ELYSIUM_PAUSER_ADDRESS"),
      keeper: requiredAddress("ELYSIUM_KEEPER_ADDRESS"),
      feeRecipient: requiredAddress("ELYSIUM_FEE_RECIPIENT_ADDRESS"),
      relayer: requiredAddress("ELYSIUM_RELAYER_ADDRESS"),
      attestor: requiredAddress("ELYSIUM_ATTESTOR_ADDRESS"),
    };

let deployer = null;
let governancePlan = null;
if (roles) {
  const [nonceHex, balanceHex] = await Promise.all([
    rpc("eth_getTransactionCount", [roles.deployer, "pending"]),
    rpc("eth_getBalance", [roles.deployer, "latest"]),
  ]);
  deployer = {
    address: roles.deployer,
    pendingNonce: Number(BigInt(nonceHex)),
    balanceWei: BigInt(balanceHex).toString(),
  };
  const root = path.resolve(import.meta.dirname, "..");
  const timelockArtifactPath = path.join(
    root,
    "packages/contracts/out-elysium/ZKBlastTimelock.sol/ZKBlastTimelock.json",
  );
  const timelockArtifact = JSON.parse(
    await readFile(timelockArtifactPath, "utf8"),
  );
  const timelockBytecode = timelockArtifact.bytecode?.object;
  const timelockRuntime = timelockArtifact.deployedBytecode?.object;
  if (
    typeof timelockBytecode !== "string" ||
    timelockBytecode === "0x" ||
    typeof timelockRuntime !== "string" ||
    timelockRuntime === "0x"
  ) {
    throw new Error("ELYSIUM_TIMELOCK_ARTIFACT_INVALID");
  }
  const predictedTimelock = getContractAddress({
    from: roles.deployer,
    nonce: BigInt(deployer.pendingNonce),
  });
  if (roles.upgrader && roles.upgrader !== predictedTimelock) {
    throw new Error("ELYSIUM_UPGRADER_PREDICTION_MISMATCH");
  }
  const minimumDelaySeconds = 300n;
  const deploymentData = encodeDeployData({
    abi: timelockArtifact.abi,
    bytecode: timelockBytecode,
    args: [minimumDelaySeconds, roles.governance],
  });
  const predictedCode = await rpc("eth_getCode", [predictedTimelock, "latest"]);
  if (predictedCode !== "0x") {
    throw new Error("ELYSIUM_PREDICTED_TIMELOCK_ALREADY_USED");
  }
  governancePlan = {
    minimumDelaySeconds: minimumDelaySeconds.toString(),
    deploymentNonce: deployer.pendingNonce,
    predictedTimelock,
    creationDataHash: keccak256(deploymentData),
    creationDataBytes: (deploymentData.length - 2) / 2,
    creationBytecodeHash: keccak256(timelockBytecode),
    runtimeBytecodeHash: keccak256(timelockRuntime),
    artifactSource: "elysium-via-ir-output",
  };
}

const resolvedRoles =
  roles && governancePlan
    ? { ...roles, upgrader: governancePlan.predictedTimelock }
    : roles;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: networkOnly ? "network-only" : "deployment-input",
  chain: {
    chainId,
    slug: descriptor.slug,
    name: descriptor.name,
    rpcSource: process.env.ELYSIUM_PRIVATE_RPC_URL ? "private" : "public",
    blockNumber: Number(BigInt(blockNumberHex)),
    blockHash: block.hash,
    l1BlockNumber: block.l1BlockNumber ?? null,
    gasPriceWei: BigInt(gasPriceHex).toString(),
  },
  canonicalContracts: codeChecks,
  roles: resolvedRoles,
  deployer,
  governancePlan,
  gates: {
    networkIdentity: true,
    canonicalCode: true,
    rolesComplete: Boolean(resolvedRoles?.upgrader),
    privateKeyRead: false,
    databaseWrite: false,
    transactionBroadcast: false,
    deploymentAllowed: false,
  },
};

if (!networkOnly) {
  const target = path.resolve(
    import.meta.dirname,
    "../deployments/elysium-testnet/preflight.json",
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o644,
  });
}
console.log(JSON.stringify(report, null, 2));
