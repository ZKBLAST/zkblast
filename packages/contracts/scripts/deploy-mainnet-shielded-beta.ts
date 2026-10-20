import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@zkblast/config";
import {
  artifact,
  check,
  readJson,
  receiptRecord,
  root,
  runtime,
  saveJson,
  type Artifact,
} from "./shielded-mainnet-runtime.js";

type Release = {
  chainId: number;
  launchMode: "experimental-single-operator";
  independentReview: false;
  proverRelease: { manifestPath: string; manifestSha256: string };
  compiledVerifierSourceSha256: string;
  artifacts: Record<string, string>;
};
const manifestPath = "deployments/mainnet/manifest.json";
const deploymentPath = "deployments/mainnet/shielded-beta.json";
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const successRecord = (receipt: TransactionReceipt) => {
  check(
    receipt.status === "success",
    "Only successful receipts may enter the public manifest",
  );
  return { ...receiptRecord(receipt), status: "success" as const };
};

async function main() {
  const state = await runtime();
  const { client, account, plan, send, safeWrite } = state;
  const release = await readJson<Release>(
    "deployments/mainnet/shielded-beta-release.json",
  );
  check(
    release.chainId === 4663 &&
      release.launchMode === "experimental-single-operator" &&
      release.independentReview === false,
    "Experimental mainnet release required",
  );
  const setupRoot = path.join(
    root,
    "packages/circuits/target/mainnet-beta-withdraw-v1",
  );
  for (const [name, expected] of Object.entries(release.artifacts)) {
    check(/^[A-Za-z0-9_.-]+$/u.test(name), "Unsafe setup artifact path");
    check(
      sha256(await readFile(path.join(setupRoot, name))) === expected,
      "Setup artifact changed",
    );
  }
  check(
    sha256(
      await readFile(
        path.join(
          root,
          "packages/contracts/src/privacy/mainnet-beta/ZKBlastBetaGroth16Verifier.sol",
        ),
      ),
    ) === release.compiledVerifierSourceSha256,
    "Generated verifier source changed",
  );
  const publicManifest = await readFile(
    path.join(root, "apps/web/public", release.proverRelease.manifestPath),
  );
  check(
    sha256(publicManifest) === release.proverRelease.manifestSha256,
    "Prover manifest changed",
  );
  const protocol = parseDeploymentManifest(await readJson(manifestPath), {
    environment: "mainnet",
    chainId: 4663,
  });
  check(
    protocol.governanceAddress.toLowerCase() ===
      plan.governance.toLowerCase() &&
      protocol.upgraderAddress.toLowerCase() === plan.upgrader.toLowerCase(),
    "Authority changed",
  );
  const delay = await client.readContract({
    address: plan.upgrader,
    abi: parseAbi(["function getMinDelay() view returns(uint256)"]),
    functionName: "getMinDelay",
  });
  check(delay === 300n, "Expected five-minute upgrade timelock");
  const token = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  const receipts: Record<string, TransactionReceipt> = {};
  const deployments: Record<
    string,
    {
      value: Artifact;
      args: readonly unknown[];
      implementation: Address;
      proxy?: Address;
      initializer?: Hex;
    }
  > = {};
  async function deploy(
    label: string,
    value: Artifact,
    args: readonly unknown[] = [],
  ) {
    const receipt = await send(label, {
      data: encodeDeployData({
        abi: value.abi,
        bytecode: value.bytecode.object,
        args,
      }),
    });
    check(receipt.contractAddress, "Contract address missing");
    receipts[label] = receipt;
    return getAddress(receipt.contractAddress);
  }
  async function immutable(name: string, args: readonly unknown[] = []) {
    const value = await artifact(name);
    const implementation = await deploy(`deploy${name}`, value, args);
    deployments[name] = { value, args, implementation };
    return implementation;
  }
  async function proxy(name: string, args: readonly unknown[]) {
    const value = await artifact(name);
    const implementation = await deploy(`deploy${name}`, value);
    const initializer = encodeFunctionData({
      abi: value.abi,
      functionName: "initialize",
      args,
    });
    const address = await deploy(
      `proxy${name}`,
      await artifact("ERC1967Proxy"),
      [implementation, initializer],
    );
    deployments[name] = {
      value,
      args,
      implementation,
      proxy: address,
      initializer,
    };
    return address;
  }
  async function configure(
    label: string,
    name: string,
    to: Address,
    functionName: string,
    args: readonly unknown[],
  ) {
    receipts[label] = await safeWrite(
      label,
      to,
      encodeFunctionData({
        abi: (await artifact(name)).abi,
        functionName,
        args,
      }),
    );
  }
  const hasher = await immutable("Poseidon2FieldHasher");
  const verifier = await immutable("ZKBlastBetaWithdrawVerifier");
  const verifierRegistry = await proxy("VerifierRegistry", [
    plan.governance,
    plan.upgrader,
  ]);
  const stateRegistry = await proxy("ShieldedStateRegistry", [
    plan.governance,
    plan.upgrader,
  ]);
  const vault = await proxy("ZKBlastVault", [
    plan.governance,
    plan.upgrader,
    stateRegistry,
    hasher,
    toHex(1n, { size: 32 }),
    1n,
  ]);
  if (protocol.shielded)
    check(
      getAddress(protocol.shielded.vault) === vault,
      "Existing shielded deployment must not be replaced",
    );
  await configure("pauseBetaVault", "ZKBlastVault", vault, "setPaused", [true]);
  const adapter = await immutable("WithdrawalVerifierAdapter", [
    verifierRegistry,
    stateRegistry,
  ]);
  const circuitHash = keccak256(
    await readFile(path.join(setupRoot, "withdraw.r1cs")),
  );
  const verificationKeyHash = keccak256(
    await readFile(path.join(setupRoot, "verification_key.json")),
  );
  await configure(
    "registerBetaVerifier",
    "VerifierRegistry",
    verifierRegistry,
    "register",
    [
      keccak256(new TextEncoder().encode("ZKBLAST_WITHDRAW")),
      1n,
      verifier,
      circuitHash,
      verificationKeyHash,
    ],
  );
  await configure(
    "authorizeBetaVault",
    "ShieldedStateRegistry",
    stateRegistry,
    "setVaultAuthorization",
    [vault, true],
  );
  await configure(
    "authorizeBetaAdapter",
    "ShieldedStateRegistry",
    stateRegistry,
    "setConsumerAuthorization",
    [adapter, true],
  );
  await configure(
    "configureBetaAdapter",
    "ZKBlastVault",
    vault,
    "setWithdrawalAdapter",
    [adapter],
  );
  await configure(
    "configureBetaUsdg",
    "ZKBlastVault",
    vault,
    "setAssetConfig",
    [token, 1_000_000n, true],
  );
  const vaultAbi = (await artifact("ZKBlastVault")).abi;
  const readVault = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName, args });
  check(
    getAddress((await readVault("withdrawalAdapter")) as Address) === adapter,
    "Withdrawal adapter mismatch",
  );
  check(
    getAddress((await readVault("lpManagerForAsset", [token])) as Address) ===
      zeroAddress,
    "Shielded LP must remain disabled",
  );
  for (const entry of Object.values(deployments).filter((item) => item.proxy)) {
    const proxyAddress = entry.proxy!;
    const slot = await client.getStorageAt({
      address: proxyAddress,
      slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    });
    check(
      slot && getAddress(`0x${slot.slice(-40)}`) === entry.implementation,
      "Proxy implementation slot mismatch",
    );
    for (const [role, owner] of [
      [toHex(0n, { size: 32 }), plan.governance],
      [
        keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
        plan.upgrader,
      ],
    ] as const)
      check(
        (await client.readContract({
          address: proxyAddress,
          abi: entry.value.abi,
          functionName: "hasRole",
          args: [role, owner],
        })) === true,
        "Proxy authority mismatch",
      );
  }
  await configure("activateBetaVault", "ZKBlastVault", vault, "setPaused", [
    false,
  ]);
  check((await readVault("paused")) === false, "Vault is still paused");

  const newContracts: DeploymentManifest["contracts"] = {};
  for (const [name, entry] of Object.entries(deployments)) {
    const code = await client.getCode({ address: entry.implementation });
    check(code && code !== "0x", "Missing deployed runtime");
    const configurationLabels: Record<string, readonly string[]> = {
      ZKBlastVault: [
        "pauseBetaVault",
        "configureBetaAdapter",
        "configureBetaUsdg",
        "activateBetaVault",
      ],
      ShieldedStateRegistry: ["authorizeBetaVault", "authorizeBetaAdapter"],
      VerifierRegistry: ["registerBetaVerifier"],
    };
    const configuration = (configurationLabels[name] ?? []).map((label) =>
      successRecord(receipts[label]!),
    );
    newContracts[name] = {
      contractName: name,
      proxyKind: entry.proxy ? "uups" : "none",
      proxyAddress: entry.proxy ?? null,
      implementationAddress: entry.implementation,
      deployerAddress: account.address,
      governanceAddress: entry.proxy ? plan.governance : null,
      upgraderAddress: entry.proxy ? plan.upgrader : null,
      artifactBytecodeHash: keccak256(entry.value.deployedBytecode.object),
      deployedRuntimeBytecodeHash: keccak256(code),
      initializerCalldataHash: entry.initializer
        ? keccak256(entry.initializer)
        : null,
      initializerArguments: entry.args.map((arg) =>
        typeof arg === "bigint" ? String(arg) : arg,
      ),
      transactions: {
        implementationDeployment: successRecord(receipts[`deploy${name}`]!),
        proxyDeploymentAndInitialization: entry.proxy
          ? successRecord(receipts[`proxy${name}`]!)
          : null,
        configuration: entry.proxy ? configuration : [],
      },
      upgrades: [],
      compiler: {
        version: entry.value.metadata.compiler.version,
        optimizer: entry.value.metadata.settings.optimizer.enabled,
        optimizerRuns: entry.value.metadata.settings.optimizer.runs,
      },
      verification: {
        implementation: "pending",
        proxy: entry.proxy ? "pending" : "not_applicable",
        urls: [],
      },
    };
  }
  const shielded = {
    vault,
    stateRegistry,
    fieldHasher: hasher,
    treeVersion: 1,
    deploymentBlock: Number(receipts.proxyZKBlastVault!.blockNumber),
    launchMode: release.launchMode,
    proverRelease: release.proverRelease,
    assets: [
      {
        address: token,
        symbol: "USDG",
        decimals: 6,
        denominationRaw: "1000000",
      },
    ],
  };
  const records = Object.fromEntries(
    Object.entries(receipts).map(([name, receipt]) => [
      name,
      successRecord(receipt),
    ]),
  );
  const totalGas = Object.values(records).reduce(
    (sum, item) => sum + BigInt(item.gasUsed),
    0n,
  );
  const next = parseDeploymentManifest({
    ...protocol,
    generatedAt: new Date().toISOString(),
    contracts: { ...protocol.contracts, ...newContracts },
    shielded,
    totals: {
      transactionCount:
        protocol.totals.transactionCount + Object.keys(records).length,
      gasUsed: String(BigInt(protocol.totals.gasUsed) + totalGas),
      totalFeeWei: String(
        BigInt(protocol.totals.totalFeeWei) +
          Object.values(records).reduce(
            (sum, item) => sum + BigInt(item.totalFeeWei),
            0n,
          ),
      ),
    },
  });
  const current = await readJson<DeploymentManifest>(manifestPath);
  if (!current.shielded) await saveJson(manifestPath, next);
  else {
    check(
      getAddress(current.shielded.vault) === vault,
      "Concurrent manifest shielded change",
    );
    // Reconcile public metadata on resume without adding deployment totals twice.
    await saveJson(manifestPath, {
      ...current,
      generatedAt: new Date().toISOString(),
      contracts: { ...current.contracts, ...newContracts },
    });
  }
  await saveJson(deploymentPath, {
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    launchMode: release.launchMode,
    independentReview: false,
    shielded,
    verifierRegistry,
    verifier,
    adapter,
    circuitHash,
    verificationKeyHash,
    transactions: records,
    totals: {
      transactionCount: Object.keys(records).length,
      gasUsed: String(totalGas),
      totalFeeWei: String(
        Object.values(records).reduce(
          (sum, item) => sum + BigInt(item.totalFeeWei),
          0n,
        ),
      ),
    },
    status: "onchain-beta-configured-ui-release-and-acceptance-pending",
  });
  console.log(
    JSON.stringify({
      configured: true,
      chainId: 4663,
      vault,
      transactionCount: Object.keys(records).length,
      totalFeeWei: String(state.spent()),
      uiAcceptance: false,
      railwayDeployed: false,
    }),
  );
}
main().catch((error: unknown) => {
  // Never print transport errors: their nested details may include RPC credentials.
  console.error(
    error instanceof Error &&
      !error.message.includes("http") &&
      error.message.length < 180
      ? error.message
      : "SHIELDED_BETA_DEPLOYMENT_FAILED; inspect private journal locally",
  );
  process.exitCode = 1;
});
