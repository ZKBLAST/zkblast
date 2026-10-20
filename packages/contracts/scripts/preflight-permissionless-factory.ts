import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { prepareSafeOperation } from "./safe-operation.js";
import {
  quoteFactoryUpgradeFees,
  type GasStage,
} from "./factory-upgrade-fees.js";

// Read-only remote transport; all transactions are sent exclusively to our local fork.
// A different chain ID makes rehearsal Safe signatures invalid on both live networks.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const forkId = 31337;
let currentStage = "configuration";
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const accessAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function setRole(bytes32,address,bool)",
  "function registry() view returns (address)",
  "function poolCount() view returns (uint256)",
  "function isRegisteredPool(address) view returns (bool)",
  "function permissionlessCreation() view returns (bool)",
  "function administrator() view returns (address)",
  "function activeBin() view returns (int24)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable returns (bytes)",
]);
type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
};
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function artifact(name: string): Promise<Artifact> {
  return JSON.parse(
    await readFile(
      path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
      "utf8",
    ),
  );
}
function runtimeFor(build: Artifact, address: Address): Hex {
  let code = build.deployedBytecode.object.slice(2);
  for (const entries of Object.values(
    build.deployedBytecode.immutableReferences ?? {},
  )) {
    for (const { start, length } of entries) {
      ensure(length === 32, "Unexpected immutable size");
      code =
        code.slice(0, start * 2) +
        address.slice(2).toLowerCase().padStart(64, "0") +
        code.slice((start + length) * 2);
    }
  }
  return `0x${code}`;
}

async function main() {
  const environment = process.env.APP_ENV;
  ensure(
    environment === "mainnet" || environment === "testnet",
    "Invalid APP_ENV",
  );
  const expectedId = environment === "mainnet" ? 4663 : 46630;
  ensure(
    Number(process.env.CHAIN_ID) === expectedId,
    "Environment chain mismatch",
  );
  const rpc = process.env.RPC_URL;
  ensure(rpc, "RPC_URL is required");
  if (process.argv.includes("--refresh-fees")) {
    currentStage = "read-only-live-fee-quote";
    const file = path.join(
      root,
      `docs/evidence/${environment}/permissionless-factory-preflight.json`,
    );
    const previous = JSON.parse(await readFile(file, "utf8")) as {
      chainId: number;
      liveBroadcast: boolean;
      governance: Address;
      candidateCreationHash: Hex;
      testnetTimelockMigrationRequired: boolean;
      upgradeStages: GasStage[];
    };
    const live = createPublicClient({ transport: http(rpc) });
    ensure(
      (await live.getChainId()) === expectedId &&
        previous.chainId === expectedId &&
        !previous.liveBroadcast,
      "Fee quote network mismatch",
    );
    const build = await artifact("PoolFactory");
    ensure(
      keccak256(build.bytecode.object) === previous.candidateCreationHash,
      "Fee quote candidate changed",
    );
    const lock = previous.testnetTimelockMigrationRequired
      ? await artifact("ZKBlastTimelock")
      : null;
    const constructorArgs = encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }],
      [300n, previous.governance],
    );
    const liveFeeQuote = await quoteFactoryUpgradeFees(
      live,
      previous.upgradeStages,
      {
        factory: build.bytecode.object,
        timelock: lock
          ? `${lock.bytecode.object}${constructorArgs.slice(2)}`
          : undefined,
      },
    );
    await writeFile(
      file,
      `${JSON.stringify({ ...previous, liveFeeQuote }, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        { environment, liveBroadcast: false, liveFeeQuote },
        null,
        2,
      ),
    );
    return;
  }
  const manifestPath = path.join(
    root,
    `deployments/${environment}/manifest.json`,
  );
  const manifestBefore = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestBefore) as {
    chainId: number;
    deployerAddress: Address;
    contracts: {
      PoolFactory: {
        proxyAddress: Address;
        implementationAddress: Address;
        governanceAddress: Address;
        upgraderAddress: Address;
        deployedRuntimeBytecodeHash: Hex;
      };
    };
    integration: { poolRegistry: Address };
  };
  const entry = manifest.contracts.PoolFactory;
  const proxy = getAddress(entry.proxyAddress),
    governor = getAddress(entry.governanceAddress);
  const oldUpgrader = getAddress(entry.upgraderAddress),
    deployer = getAddress(manifest.deployerAddress);
  const registry = getAddress(manifest.integration.poolRegistry);
  const live = createPublicClient({
    transport: http(rpc, { timeout: 30_000, retryCount: 1 }),
  });
  currentStage = "live-chain-and-proxy-checks";
  ensure(
    (await live.getChainId()) === expectedId && manifest.chainId === expectedId,
    "RPC/manifest chain mismatch",
  );
  const block = await live.getBlockNumber();
  const role = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
  const [
    currentSlot,
    implementationCode,
    governorAdmin,
    upgradeRole,
    registryLive,
    poolCount,
    nonce,
    gasPrice,
    balance,
    upgraderCode,
  ] = await Promise.all([
    live.getStorageAt({ address: proxy, slot, blockNumber: block }),
    live.getBytecode({
      address: entry.implementationAddress,
      blockNumber: block,
    }),
    live.readContract({
      address: proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [zeroHash, governor],
      blockNumber: block,
    }),
    live.readContract({
      address: proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [role, oldUpgrader],
      blockNumber: block,
    }),
    live.readContract({
      address: proxy,
      abi: accessAbi,
      functionName: "registry",
      blockNumber: block,
    }),
    live.readContract({
      address: registry,
      abi: accessAbi,
      functionName: "poolCount",
      blockNumber: block,
    }),
    live.getTransactionCount({ address: deployer, blockNumber: block }),
    live.getGasPrice(),
    live.getBalance({ address: deployer, blockNumber: block }),
    live.getBytecode({ address: oldUpgrader, blockNumber: block }),
  ]);
  ensure(
    currentSlot &&
      getAddress(`0x${currentSlot.slice(-40)}`) ===
        getAddress(entry.implementationAddress),
    "Implementation drift",
  );
  ensure(
    implementationCode &&
      keccak256(implementationCode) === entry.deployedRuntimeBytecodeHash,
    "Live runtime hash mismatch",
  );
  ensure(
    governorAdmin && upgradeRole && getAddress(registryLive) === registry,
    "Factory role/registry mismatch",
  );
  const existingTimelock = Boolean(upgraderCode && upgraderCode !== "0x");
  ensure(
    environment !== "mainnet" || existingTimelock,
    "Mainnet timelock missing",
  );
  if (existingTimelock) {
    ensure(
      (await live.readContract({
        address: oldUpgrader,
        abi: timelockAbi,
        functionName: "getMinDelay",
        blockNumber: block,
      })) === 300n,
      "Timelock must be exactly 300 seconds",
    );
    for (const name of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
      ensure(
        await live.readContract({
          address: oldUpgrader,
          abi: timelockAbi,
          functionName: "hasRole",
          args: [keccak256(toHex(name)), governor],
          blockNumber: block,
        }),
        `Governance lacks ${name}`,
      );
    }
  }
  const build = await artifact("PoolFactory");
  ensure(
    (build.deployedBytecode.object.length - 2) / 2 <= 24576,
    "EIP170 runtime limit exceeded",
  );
  const forkUrl = `http://127.0.0.1:${environment === "mainnet" ? 18547 : 18546}`;
  const forkChain = defineChain({
    id: forkId,
    name: "Isolated rehearsal",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [forkUrl] } },
  });
  const local = createPublicClient({
    chain: forkChain,
    transport: http(forkUrl, { retryCount: 0 }),
  });
  const request = local.request as unknown as (input: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  currentStage = "local-fork-startup";
  const child = spawn(
    process.env.ANVIL_BINARY ??
      (existsSync(path.join(homedir(), ".foundry/bin/anvil"))
        ? path.join(homedir(), ".foundry/bin/anvil")
        : "anvil"),
    [
      "--host",
      "127.0.0.1",
      "--port",
      new URL(forkUrl).port,
      "--chain-id",
      String(forkId),
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let startupError = false;
  child.once("error", () => {
    startupError = true;
  });
  const receipts: {
    stage: string;
    gasUsed: string;
    estimateGas: string;
    fundingAccount: Address;
    forkTransactionHash: Hex;
  }[] = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt++) {
      ensure(
        !startupError && child.exitCode === null,
        "Local fork unavailable or port in use",
      );
      try {
        await local.getBlockNumber();
        ready = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    ensure(ready && child.exitCode === null, "Local fork startup failed");
    await request({
      method: "anvil_reset",
      params: [{ forking: { jsonRpcUrl: rpc, blockNumber: Number(block) } }],
    });
    ensure((await local.getChainId()) === forkId, "Unsafe rehearsal chain ID");
    const wallet = (account: Address) =>
      createWalletClient({
        account,
        chain: forkChain,
        transport: http(forkUrl),
      });
    for (const account of [deployer, governor, oldUpgrader]) {
      await request({ method: "anvil_impersonateAccount", params: [account] });
      await request({
        method: "anvil_setBalance",
        params: [account, toHex(10n ** 20n)],
      });
    }
    const record = async (
      stage: string,
      fundingAccount: Address,
      transaction: { to?: Address; data: Hex },
    ) => {
      currentStage = `fork-${stage}`;
      const estimate = await local.estimateGas({
        account: fundingAccount,
        ...transaction,
      });
      const hash = await wallet(fundingAccount).sendTransaction({
        ...transaction,
        gas: (estimate * 12n) / 10n,
      });
      const receipt = await local.waitForTransactionReceipt({ hash });
      ensure(receipt.status === "success", `Fork stage failed: ${stage}`);
      receipts.push({
        stage,
        fundingAccount,
        gasUsed: receipt.gasUsed.toString(),
        estimateGas: estimate.toString(),
        forkTransactionHash: hash,
      });
      return receipt;
    };
    const governorCode = await live.getBytecode({
      address: governor,
      blockNumber: block,
    });
    const usesSafe = Boolean(governorCode && governorCode !== "0x");
    if (
      usesSafe &&
      process.env.FACTORY_REHEARSAL_USE_TESTNET_SIGNERS === "true"
    ) {
      // Owner-selected same wallets; in-memory fallback only, never rewrite env files.
      // prepareSafeOperation independently validates both addresses against Safe owners.
      const localSecrets = parseEnv(
        await readFile(path.join(root, ".env.testnet"), "utf8"),
      );
      for (const name of ["GOVERNANCE_PRIVATE_KEY", "UPGRADER_PRIVATE_KEY"]) {
        if (!process.env[name]?.trim()) process.env[name] = localSecrets[name];
      }
    }
    ensure(
      environment !== "mainnet" || usesSafe,
      "Mainnet governance must be Safe",
    );
    const govern = async (stage: string, to: Address, data: Hex) => {
      currentStage = `fork-prepare-${stage}`;
      if (!usesSafe) return record(stage, governor, { to, data });
      const prepared = await prepareSafeOperation(local, {
        chainId: forkId,
        safe: governor,
        to,
        data,
        relayer: deployer,
      });
      return record(stage, deployer, { to: prepared.to, data: prepared.data });
    };
    const predicted = getContractAddress({
      from: deployer,
      nonce: BigInt(nonce),
    });
    const deployed = await record("deploy-factory-implementation", deployer, {
      data: build.bytecode.object,
    });
    ensure(
      deployed.contractAddress &&
        getAddress(deployed.contractAddress) === predicted,
      "Candidate nonce drift",
    );
    const candidateCode = await local.getBytecode({ address: predicted });
    ensure(
      candidateCode &&
        keccak256(candidateCode) === keccak256(runtimeFor(build, predicted)),
      "Candidate runtime mismatch",
    );
    let timelock = oldUpgrader;
    if (!existingTimelock) {
      ensure(
        environment === "testnet" && !usesSafe,
        "Unsupported governance migration",
      );
      const lockBuild = await artifact("ZKBlastTimelock");
      const constructorArgs = encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }],
        [300n, governor],
      );
      const lockReceipt = await record("deploy-testnet-timelock", deployer, {
        data: `${lockBuild.bytecode.object}${constructorArgs.slice(2)}`,
      });
      ensure(lockReceipt.contractAddress, "Missing timelock deployment");
      timelock = getAddress(lockReceipt.contractAddress);
      await govern(
        "grant-timelock-upgrader",
        proxy,
        encodeFunctionData({
          abi: accessAbi,
          functionName: "setRole",
          args: [role, timelock, true],
        }),
      );
    }
    ensure(
      (await local.readContract({
        address: timelock,
        abi: timelockAbi,
        functionName: "getMinDelay",
      })) === 300n,
      "Fork delay mismatch",
    );
    const upgrade = encodeFunctionData({
      abi: build.abi,
      functionName: "upgradeToAndCall",
      args: [predicted, "0x"],
    });
    const salt = keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "bytes32" }],
        [
          "ZKBLAST_PERMISSIONLESS_FACTORY",
          BigInt(expectedId),
          keccak256(build.bytecode.object),
        ],
      ),
    );
    const operation = [proxy, 0n, upgrade, zeroHash, salt] as const;
    await govern(
      "schedule-upgrade",
      timelock,
      encodeFunctionData({
        abi: timelockAbi,
        functionName: "schedule",
        args: [...operation, 300n],
      }),
    );
    if (!existingTimelock) {
      await govern(
        "revoke-direct-wallet-upgrader",
        proxy,
        encodeFunctionData({
          abi: accessAbi,
          functionName: "setRole",
          args: [role, oldUpgrader, false],
        }),
      );
      ensure(
        !(await local.readContract({
          address: proxy,
          abi: accessAbi,
          functionName: "hasRole",
          args: [role, oldUpgrader],
        })),
        "Direct upgrader still enabled",
      );
    }
    let prematureRejected = false;
    try {
      await local.simulateContract({
        account: governor,
        address: timelock,
        abi: timelockAbi,
        functionName: "execute",
        args: operation,
      });
    } catch {
      prematureRejected = true;
    }
    ensure(prematureRejected, "Premature execution accepted");
    await request({ method: "evm_increaseTime", params: [301] });
    await request({ method: "evm_mine", params: [] });
    await govern(
      "execute-upgrade",
      timelock,
      encodeFunctionData({
        abi: timelockAbi,
        functionName: "execute",
        args: operation,
      }),
    );
    const afterSlot = await local.getStorageAt({ address: proxy, slot });
    ensure(
      afterSlot && getAddress(`0x${afterSlot.slice(-40)}`) === predicted,
      "Proxy slot mismatch after upgrade",
    );
    ensure(
      await local.readContract({
        address: proxy,
        abi: accessAbi,
        functionName: "permissionlessCreation",
      }),
      "Public creation not enabled",
    );
    ensure(
      getAddress(
        await local.readContract({
          address: proxy,
          abi: accessAbi,
          functionName: "registry",
        }),
      ) === registry,
      "Registry storage changed",
    );
    ensure(
      (await local.readContract({
        address: registry,
        abi: accessAbi,
        functionName: "poolCount",
      })) === poolCount,
      "Existing pool count changed",
    );
    const stranger = getAddress("0x00000000000000000000000000000000000a11ce");
    await request({ method: "anvil_impersonateAccount", params: [stranger] });
    await request({
      method: "anvil_setBalance",
      params: [stranger, toHex(10n ** 19n)],
    });
    ensure(
      !(await local.readContract({
        address: proxy,
        abi: accessAbi,
        functionName: "hasRole",
        args: [zeroHash, stranger],
      })),
      "Acceptance wallet unexpectedly admin",
    );
    const tokenA = getAddress(process.env.EXECUTION_USDG_ADDRESS ?? "");
    // A second real token contract is read from existing pool configuration, not invented metadata.
    const tokenB = getAddress(process.env.EXECUTION_WETH_ADDRESS ?? "");
    for (const model of ["damm", "dlmm"] as const) {
      const functionName = model === "damm" ? "createPool" : "createDlmmPool";
      const args =
        model === "damm"
          ? [tokenA, tokenB, 0, 7391, 0]
          : [tokenA, tokenB, 7391, 37, -100];
      const simulation = await local.simulateContract({
        account: stranger,
        address: proxy,
        abi: build.abi,
        functionName,
        args,
      });
      const newPool = simulation.result as Address;
      const receipt = await record(
        `acceptance-create-${model}-fork-only`,
        stranger,
        {
          to: proxy,
          data: encodeFunctionData({ abi: build.abi, functionName, args }),
        },
      );
      ensure(
        receipt.status === "success" &&
          (await local.readContract({
            address: registry,
            abi: accessAbi,
            functionName: "isRegisteredPool",
            args: [newPool],
          })),
        "Public pool registration failed",
      );
      ensure(
        getAddress(
          await local.readContract({
            address: newPool,
            abi: accessAbi,
            functionName: "administrator",
          }),
        ) === stranger,
        "Creator administrator mismatch",
      );
    }
    const upgradeStages = receipts.filter(
      (item) => !item.stage.startsWith("acceptance-"),
    );
    const totalGas = upgradeStages.reduce(
      (sum, item) => sum + BigInt(item.gasUsed),
      0n,
    );
    const estimateGas = upgradeStages.reduce(
      (sum, item) => sum + BigInt(item.estimateGas),
      0n,
    );
    const suggestedGasLimit = (estimateGas * 125n + 99n) / 100n;
    const suggestedGasPriceCap = gasPrice * 2n;
    const [deployerNow, governorBalance] = await Promise.all([
      live.getBalance({ address: deployer }),
      live.getBalance({ address: governor }),
    ]);
    ensure(
      (await readFile(manifestPath, "utf8")) === manifestBefore,
      "Live manifest modified",
    );
    ensure(
      (await live.getStorageAt({ address: proxy, slot })) === currentSlot,
      "Live proxy changed during rehearsal",
    );
    const result = {
      generatedAt: new Date().toISOString(),
      environment,
      chainId: expectedId,
      forkChainId: forkId,
      forkOnly: true,
      liveBroadcast: false,
      observedBlock: block.toString(),
      proxy,
      previousImplementation: entry.implementationAddress,
      predictedImplementation: predicted,
      candidateCreationHash: keccak256(build.bytecode.object),
      candidateRuntimeHash: keccak256(candidateCode),
      runtimeBytes: (candidateCode.length - 2) / 2,
      timelock,
      delaySeconds: 300,
      governance: governor,
      governanceKind: usesSafe ? "safe-2-of-2" : "testnet-single-wallet",
      testnetTimelockMigrationRequired: !existingTimelock,
      directWalletUpgradeRevokedOnFork: !existingTimelock,
      prematureExecutionRejected: prematureRejected,
      registryAndPoolCountPreserved: true,
      publicDammAndDlmmCreationPassed: true,
      liveManifestUnchanged: true,
      liveProxyUnchanged: true,
      upgradeTransactionCount: upgradeStages.length,
      upgradeStages,
      acceptanceTransactions: receipts.filter((item) =>
        item.stage.startsWith("acceptance-"),
      ),
      gasPriceWei: gasPrice.toString(),
      measuredGas: totalGas.toString(),
      estimatedGas: estimateGas.toString(),
      estimatedFeeETH: formatEther(totalGas * gasPrice),
      suggestedGasLimit: suggestedGasLimit.toString(),
      suggestedGasPriceCapWei: suggestedGasPriceCap.toString(),
      suggestedFeeCeilingETH: formatEther(
        suggestedGasLimit * suggestedGasPriceCap,
      ),
      observedDeployerBalanceETH: formatEther(balance),
      currentDeployerBalanceETH: formatEther(deployerNow),
      governorBalanceETH: formatEther(governorBalance),
      caveats: [
        "Quote uses observed gas price, not a guaranteed final fee; re-estimate before each live step.",
        "Fork signatures use chain 31337 and cannot authorize live Safe transactions.",
        "Native gas quote excludes any separately charged L1 data/operator fee and future price changes.",
        "Predicted addresses depend on unchanged deployer nonce; do not broadcast this rehearsal output.",
        "Public pool creation acceptance occurred only on fork and is excluded from upgrade cost.",
      ],
    };
    const destination = path.join(
      root,
      `docs/evidence/${environment}/permissionless-factory-preflight.json`,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    child.kill("SIGTERM");
  }
}
main().catch((error: unknown) => {
  // Never serialize transport errors, RPC URLs, environment values or Safe signatures.
  console.error(
    `FACTORY_PREFLIGHT_FAILED at ${currentStage}; no live broadcast was performed.`,
  );
  const known = [
    "Safe owner or threshold mismatch",
    "Safe EIP712 hash mismatch",
    "Safe operation simulation failed",
    "Candidate nonce drift",
    "Candidate runtime mismatch",
    "Fork stage failed: deploy-factory-implementation",
  ];
  if (error instanceof Error && known.includes(error.message))
    console.error(error.message);
  if (error instanceof Error) {
    console.error(`Diagnostic type: ${error.name.replace(/[^a-zA-Z]/gu, "")}`);
    const code = error.message.match(/\bGS\d{3}\b/u)?.[0];
    if (code) console.error(`Safe revert: ${code}`);
    const missing = error.message.match(
      /^Missing or invalid (GOVERNANCE_PRIVATE_KEY|UPGRADER_PRIVATE_KEY)$/u,
    )?.[0];
    if (missing) console.error(missing);
  }
  process.exitCode = 1;
});
