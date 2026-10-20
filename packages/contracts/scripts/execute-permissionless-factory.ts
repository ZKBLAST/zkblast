import path from "node:path";
import {
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseEther,
  toHex,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "../../config/src/deployment.js";
import { prepareSafeOperation } from "./safe-operation.js";
import { verifyPublicFactory } from "./verify-public-factory.js";
import {
  boundedTransactions,
  spentWei,
  type UpgradeJournal,
} from "./bounded-upgrade-transactions.js";
import {
  accessAbi,
  accountFor,
  artifact,
  check,
  implementationSlot,
  loadSameWallets,
  readJson,
  root,
  runtimeFor,
  save,
  timelockAbi,
} from "./permissionless-upgrade-support.js";

type Plan = {
  environment: "testnet" | "mainnet";
  chainId: number;
  proxy: Address;
  previousImplementation: Address;
  newImplementation: Address;
  creationHash: Hex;
  registry: Address;
  poolCount: string;
  governor: Address;
  oldUpgrader: Address;
  timelock: Address;
  migrate: boolean;
  capWei: string;
  gasPriceCapWei: string;
  stageGas: Record<string, string>;
  deployer: Address;
  operationId: Hex;
  scheduleData: Hex;
  executeData: Hex;
  planHash: Hex;
};
type Journal = UpgradeJournal & { plan: Plan; complete?: boolean };
type Preflight = {
  chainId: number;
  proxy: Address;
  previousImplementation: Address;
  candidateCreationHash: Hex;
  publicDammAndDlmmCreationPassed: boolean;
  prematureExecutionRejected: boolean;
  liveFeeQuote: {
    suggestedGasPriceCapWei: string;
    stages: { stage: string; estimateGas: string }[];
  };
};
let phase = "configuration";
async function main() {
  const environment = process.env.APP_ENV;
  check(
    environment === "testnet" || environment === "mainnet",
    "INVALID_ENVIRONMENT",
  );
  const chainId = Number(process.env.CHAIN_ID);
  check(
    chainId === (environment === "mainnet" ? 4663 : 46630),
    "INVALID_CHAIN",
  );
  check(
    process.argv.includes("--broadcast"),
    "BROADCAST_CONFIRMATION_REQUIRED",
  );
  const cap = process.argv
    .find((arg) => arg.startsWith("--cap-eth="))
    ?.split("=")[1];
  check(
    cap === (environment === "mainnet" ? "0.0003" : "0.0002"),
    "APPROVED_CAP_REQUIRED",
  );
  const rpc = process.env.RPC_URL;
  check(
    rpc && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(rpc).hostname),
    "LIVE_RPC_REQUIRED",
  );
  await loadSameWallets();
  const manifestFile = path.join(
    root,
    `deployments/${environment}/manifest.json`,
  );
  const manifest = await readJson<DeploymentManifest>(manifestFile);
  parseDeploymentManifest(manifest, { environment, chainId });
  const target = manifest.contracts.PoolFactory;
  check(
    target?.proxyAddress && target.governanceAddress && target.upgraderAddress,
    "FACTORY_MANIFEST_REQUIRED",
  );
  const chain = defineChain({
    id: chainId,
    name: manifest.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(rpc, { retryCount: 1 }),
  });
  check((await client.getChainId()) === chainId, "RPC_CHAIN_MISMATCH");
  const deployer = accountFor(
    "DEPLOYER_PRIVATE_KEY",
    getAddress(manifest.deployerAddress),
  );
  const build = await artifact("PoolFactory");
  const preflight = await readJson<Preflight>(
    path.join(
      root,
      `docs/evidence/${environment}/permissionless-factory-preflight.json`,
    ),
  );
  check(
    preflight.chainId === chainId &&
      preflight.publicDammAndDlmmCreationPassed &&
      preflight.prematureExecutionRejected,
    "PREFLIGHT_REQUIRED",
  );
  check(
    keccak256(build.bytecode.object) === preflight.candidateCreationHash,
    "APPROVED_ARTIFACT_CHANGED",
  );
  const journalFile = path.join(
    root,
    `deployments/${environment}/permissionless-factory-upgrade.private.json`,
  );
  let existingJournal = await readJson<Journal>(journalFile).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    },
  );
  const role = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
  if (!existingJournal) {
    phase = "plan-validation";
    const proxy = getAddress(target.proxyAddress),
      governor = getAddress(target.governanceAddress);
    const oldUpgrader = getAddress(target.upgraderAddress);
    check(
      proxy === getAddress(preflight.proxy) &&
        getAddress(target.implementationAddress) ===
          getAddress(preflight.previousImplementation),
      "PREFLIGHT_PROXY_DRIFT",
    );
    const current = await client.getStorageAt({
      address: proxy,
      slot: implementationSlot,
    });
    check(
      current &&
        getAddress(`0x${current.slice(-40)}`) ===
          getAddress(target.implementationAddress),
      "IMPLEMENTATION_DRIFT",
    );
    const oldCode = await client.getBytecode({
      address: getAddress(target.implementationAddress),
    });
    check(
      oldCode && keccak256(oldCode) === target.deployedRuntimeBytecodeHash,
      "OLD_RUNTIME_MISMATCH",
    );
    check(
      await client.readContract({
        address: proxy,
        abi: accessAbi,
        functionName: "hasRole",
        args: [zeroHash, governor],
      }),
      "GOVERNOR_ROLE_MISMATCH",
    );
    check(
      await client.readContract({
        address: proxy,
        abi: accessAbi,
        functionName: "hasRole",
        args: [role, oldUpgrader],
      }),
      "UPGRADER_ROLE_MISMATCH",
    );
    const upgraderCode = await client.getBytecode({ address: oldUpgrader });
    const migrate = !upgraderCode || upgraderCode === "0x";
    check(!migrate || environment === "testnet", "MAINNET_TIMELOCK_REQUIRED");
    if (!migrate)
      check(
        (await client.readContract({
          address: oldUpgrader,
          abi: timelockAbi,
          functionName: "getMinDelay",
        })) === 300n,
        "TIMELOCK_DELAY_CHANGED",
      );
    const nonce = await client.getTransactionCount({
      address: deployer.address,
      blockTag: "pending",
    });
    const newImplementation = getContractAddress({
      from: deployer.address,
      nonce: BigInt(nonce),
    });
    const timelock = migrate
      ? getContractAddress({ from: deployer.address, nonce: BigInt(nonce + 1) })
      : oldUpgrader;
    const upgrade = encodeFunctionData({
      abi: build.abi,
      functionName: "upgradeToAndCall",
      args: [newImplementation, "0x"],
    });
    const salt = keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "bytes32" }],
        [
          "ZKBLAST_PERMISSIONLESS_FACTORY",
          BigInt(chainId),
          keccak256(build.bytecode.object),
        ],
      ),
    );
    const operation = [proxy, 0n, upgrade, zeroHash, salt] as const;
    const registry = getAddress(manifest.integration.poolRegistry);
    check(
      getAddress(
        await client.readContract({
          address: proxy,
          abi: accessAbi,
          functionName: "registry",
        }),
      ) === registry,
      "REGISTRY_MISMATCH",
    );
    const body: Omit<Plan, "planHash"> = {
      environment,
      chainId,
      proxy,
      governor,
      oldUpgrader,
      registry,
      previousImplementation: getAddress(target.implementationAddress),
      newImplementation,
      creationHash: keccak256(build.bytecode.object),
      timelock,
      migrate,
      poolCount: (
        await client.readContract({
          address: registry,
          abi: accessAbi,
          functionName: "poolCount",
        })
      ).toString(),
      capWei: parseEther(cap).toString(),
      gasPriceCapWei: preflight.liveFeeQuote.suggestedGasPriceCapWei,
      stageGas: Object.fromEntries(
        preflight.liveFeeQuote.stages.map((item) => [
          item.stage,
          item.estimateGas,
        ]),
      ),
      deployer: deployer.address,
      operationId: keccak256(
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "uint256" },
            { type: "bytes" },
            { type: "bytes32" },
            { type: "bytes32" },
          ],
          operation,
        ),
      ),
      scheduleData: encodeFunctionData({
        abi: timelockAbi,
        functionName: "schedule",
        args: [...operation, 300n],
      }),
      executeData: encodeFunctionData({
        abi: timelockAbi,
        functionName: "execute",
        args: operation,
      }),
    };
    existingJournal = {
      plan: { ...body, planHash: keccak256(toHex(JSON.stringify(body))) },
      steps: {},
    };
    await save(journalFile, existingJournal);
  }
  check(existingJournal, "JOURNAL_REQUIRED");
  const journal = existingJournal;
  const plan = journal.plan;
  const liveSlot = await client.getStorageAt({
    address: plan.proxy,
    slot: implementationSlot,
  });
  check(
    liveSlot &&
      [plan.previousImplementation, plan.newImplementation].includes(
        getAddress(`0x${liveSlot.slice(-40)}`),
      ),
    "LIVE_PROXY_DRIFT",
  );
  const { planHash, ...body } = plan;
  check(
    keccak256(toHex(JSON.stringify(body))) === planHash &&
      plan.capWei === parseEther(cap).toString(),
    "PLAN_INTEGRITY_MISMATCH",
  );
  check(
    plan.chainId === chainId &&
      plan.creationHash === keccak256(build.bytecode.object) &&
      plan.deployer === deployer.address,
    "PLAN_CONTEXT_MISMATCH",
  );
  if (environment === "testnet")
    accountFor("GOVERNANCE_PRIVATE_KEY", plan.governor);
  if (
    environment === "mainnet" &&
    !journal.steps["deploy-factory-implementation"]
  ) {
    // Validate actual Safe owners/signatures before spending deployment gas.
    await prepareSafeOperation(client, {
      chainId,
      safe: plan.governor,
      to: plan.timelock,
      data: plan.scheduleData,
      relayer: deployer,
    });
  }
  const order = [
    "deploy-factory-implementation",
    ...(plan.migrate
      ? ["deploy-testnet-timelock", "grant-timelock-upgrader"]
      : []),
    "schedule-upgrade",
    ...(plan.migrate ? ["revoke-direct-wallet-upgrader"] : []),
    "execute-upgrade",
  ];
  const send = boundedTransactions({
    client,
    chain,
    rpc,
    journal,
    journalFile,
    remainingReserve: (stage) =>
      order
        .slice(order.indexOf(stage) + 1)
        .filter((name) => !journal.steps[name])
        .reduce(
          (sum, name) =>
            sum +
            ((BigInt(plan.stageGas[name] ?? "0") * 125n + 99n) / 100n) *
              BigInt(plan.gasPriceCapWei),
          0n,
        ),
  });
  const govern = async (stage: string, to: Address, data: Hex) => {
    phase = stage;
    if (journal.steps[stage]) return send(stage, deployer, { to, data });
    if (environment === "testnet")
      return send(stage, accountFor("GOVERNANCE_PRIVATE_KEY", plan.governor), {
        to,
        data,
      });
    const prepared = await prepareSafeOperation(client, {
      chainId,
      safe: plan.governor,
      to,
      data,
      relayer: deployer,
    });
    return send(stage, deployer, { to: prepared.to, data: prepared.data });
  };
  const verifyCandidate = async () => {
    const code = await client.getBytecode({ address: plan.newImplementation });
    check(
      code &&
        keccak256(code) ===
          keccak256(runtimeFor(build, plan.newImplementation)),
      "CANDIDATE_RUNTIME_MISMATCH",
    );
  };
  if (!process.argv.includes("--execute")) {
    phase = "deploy-factory-implementation";
    if (!journal.steps[phase])
      check(
        getContractAddress({
          from: deployer.address,
          nonce: BigInt(
            await client.getTransactionCount({
              address: deployer.address,
              blockTag: "pending",
            }),
          ),
        }) === plan.newImplementation,
        "DEPLOYER_NONCE_DRIFT",
      );
    const deployment = await send(phase, deployer, {
      data: build.bytecode.object,
    });
    check(
      deployment.contractAddress &&
        getAddress(deployment.contractAddress) === plan.newImplementation,
      "DEPLOYED_ADDRESS_MISMATCH",
    );
    await verifyCandidate();
    if (plan.migrate) {
      phase = "deploy-testnet-timelock";
      const lock = await artifact("ZKBlastTimelock");
      const args = encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }],
        [300n, plan.governor],
      );
      if (!journal.steps[phase])
        check(
          getContractAddress({
            from: deployer.address,
            nonce: BigInt(
              await client.getTransactionCount({
                address: deployer.address,
                blockTag: "pending",
              }),
            ),
          }) === plan.timelock,
          "TIMELOCK_NONCE_DRIFT",
        );
      const deployed = await send(phase, deployer, {
        data: `${lock.bytecode.object}${args.slice(2)}`,
      });
      check(
        deployed.contractAddress &&
          getAddress(deployed.contractAddress) === plan.timelock,
        "TIMELOCK_ADDRESS_MISMATCH",
      );
      const code = await client.getBytecode({ address: plan.timelock });
      check(
        code && keccak256(code) === keccak256(runtimeFor(lock, plan.timelock)),
        "TIMELOCK_RUNTIME_MISMATCH",
      );
      await govern(
        "grant-timelock-upgrader",
        plan.proxy,
        encodeFunctionData({
          abi: accessAbi,
          functionName: "setRole",
          args: [role, plan.timelock, true],
        }),
      );
    }
    check(
      (await client.readContract({
        address: plan.timelock,
        abi: timelockAbi,
        functionName: "getMinDelay",
      })) === 300n,
      "TIMELOCK_DELAY_CHANGED",
    );
    for (const name of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"])
      check(
        await client.readContract({
          address: plan.timelock,
          abi: timelockAbi,
          functionName: "hasRole",
          args: [keccak256(toHex(name)), plan.governor],
        }),
        "TIMELOCK_GOVERNANCE_MISMATCH",
      );
    await govern("schedule-upgrade", plan.timelock, plan.scheduleData);
    const readyAt = await client.readContract({
      address: plan.timelock,
      abi: timelockAbi,
      functionName: "getTimestamp",
      args: [plan.operationId],
    });
    check(readyAt > 1n, "UPGRADE_NOT_SCHEDULED");
    if (plan.migrate) {
      await govern(
        "revoke-direct-wallet-upgrader",
        plan.proxy,
        encodeFunctionData({
          abi: accessAbi,
          functionName: "setRole",
          args: [role, plan.oldUpgrader, false],
        }),
      );
      check(
        !(await client.readContract({
          address: plan.proxy,
          abi: accessAbi,
          functionName: "hasRole",
          args: [role, plan.oldUpgrader],
        })),
        "DIRECT_UPGRADER_STILL_ENABLED",
      );
    }
    console.log(
      JSON.stringify({
        environment,
        phase: "scheduled",
        readyAt: readyAt.toString(),
        readyAtUTC: new Date(Number(readyAt) * 1000).toISOString(),
        planHash,
        feeETH: formatEther(spentWei(journal)),
      }),
    );
    return;
  }
  phase = "execute-upgrade";
  check(
    journal.steps["schedule-upgrade"]?.receipt &&
      (!plan.migrate ||
        journal.steps["revoke-direct-wallet-upgrader"]?.receipt),
    "SCHEDULE_MIGRATION_INCOMPLETE",
  );
  await verifyCandidate();
  check(
    (await client.readContract({
      address: plan.timelock,
      abi: timelockAbi,
      functionName: "getMinDelay",
    })) === 300n,
    "TIMELOCK_DELAY_CHANGED",
  );
  const readyAt = await client.readContract({
    address: plan.timelock,
    abi: timelockAbi,
    functionName: "getTimestamp",
    args: [plan.operationId],
  });
  check(
    journal.steps[phase]?.receipt ||
      (readyAt > 1n && (await client.getBlock()).timestamp >= readyAt),
    "TIMELOCK_NOT_READY",
  );
  await govern(phase, plan.timelock, plan.executeData);
  const stored = await client.getStorageAt({
    address: plan.proxy,
    slot: implementationSlot,
  });
  check(
    stored && getAddress(`0x${stored.slice(-40)}`) === plan.newImplementation,
    "LIVE_IMPLEMENTATION_MISMATCH",
  );
  check(
    await client.readContract({
      address: plan.timelock,
      abi: timelockAbi,
      functionName: "isOperationDone",
      args: [plan.operationId],
    }),
    "OPERATION_NOT_DONE",
  );
  check(
    await client.readContract({
      address: plan.proxy,
      abi: accessAbi,
      functionName: "permissionlessCreation",
    }),
    "PERMISSIONLESS_NOT_ENABLED",
  );
  check(
    getAddress(
      await client.readContract({
        address: plan.proxy,
        abi: accessAbi,
        functionName: "registry",
      }),
    ) === plan.registry,
    "REGISTRY_CHANGED",
  );
  check(
    (await client.readContract({
      address: plan.registry,
      abi: accessAbi,
      functionName: "poolCount",
    })) >= BigInt(plan.poolCount),
    "POOL_COUNT_DECREASED",
  );
  if (plan.migrate)
    check(
      !(await client.readContract({
        address: plan.proxy,
        abi: accessAbi,
        functionName: "hasRole",
        args: [role, plan.oldUpgrader],
      })),
      "DIRECT_UPGRADER_STILL_ENABLED",
    );
  phase = "post-upgrade-read-only-acceptance";
  const acceptance = await verifyPublicFactory(client, {
    proxy: plan.proxy,
    registry: plan.registry,
    governor: plan.governor,
    timelock: plan.timelock,
    oldUpgrader: plan.oldUpgrader,
    migrated: plan.migrate,
    factoryAbi: build.abi,
  });
  if (!journal.complete) {
    const steps = order.map((stage) => {
      const receipt = journal.steps[stage]?.receipt;
      check(receipt?.status === "success", "RECEIPT_LEDGER_INCOMPLETE");
      return receipt;
    });
    if (getAddress(target.implementationAddress) !== plan.newImplementation) {
      const upgrade = {
        previousImplementationAddress: plan.previousImplementation,
        newImplementationAddress: plan.newImplementation,
        implementationDeployment: steps[0]!,
        proxyUpgrade: steps.at(-1)!,
        planHash,
        operationId: plan.operationId,
        delaySeconds: 300,
        receipts: steps,
        permissionlessCreation: true,
      };
      // All receipt statuses were checked above; schema validation runs before the manifest is saved.
      target.upgrades.push(upgrade as (typeof target.upgrades)[number]);
      target.implementationAddress = plan.newImplementation;
      target.upgraderAddress = plan.timelock;
      target.artifactBytecodeHash = keccak256(build.deployedBytecode.object);
      target.deployedRuntimeBytecodeHash = keccak256(
        runtimeFor(build, plan.newImplementation),
      );
      target.verification.implementation = "pending";
      manifest.generatedAt = new Date().toISOString();
      manifest.totals.transactionCount += steps.length;
      manifest.totals.gasUsed = (
        BigInt(manifest.totals.gasUsed) +
        steps.reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)
      ).toString();
      manifest.totals.totalFeeWei = (
        BigInt(manifest.totals.totalFeeWei) + spentWei(journal)
      ).toString();
      parseDeploymentManifest(manifest, { environment, chainId });
      await save(manifestFile, manifest);
    }
    const evidence = {
      ...plan,
      complete: true,
      generatedAt: new Date().toISOString(),
      transactions: steps,
      totalGasUsed: steps
        .reduce((sum, item) => sum + BigInt(item.gasUsed), 0n)
        .toString(),
      totalFeeWei: spentWei(journal).toString(),
      totalFeeETH: formatEther(spentWei(journal)),
      railwayDeployed: false,
      acceptance,
      timelockRuntimeHash: keccak256(
        (await client.getBytecode({ address: plan.timelock }))!,
      ),
      timelockConstructorArguments: plan.migrate ? [300, plan.governor] : null,
    };
    await save(
      path.join(
        root,
        `deployments/${environment}/permissionless-factory-upgrade.json`,
      ),
      evidence,
    );
    await save(
      path.join(
        root,
        `docs/evidence/${environment}/permissionless-factory-live.json`,
      ),
      evidence,
    );
    journal.complete = true;
    await save(journalFile, journal);
  }
  console.log(
    JSON.stringify({
      environment,
      complete: true,
      proxy: plan.proxy,
      implementation: plan.newImplementation,
      timelock: plan.timelock,
      delaySeconds: 300,
      totalFeeETH: formatEther(spentWei(journal)),
      railwayDeployed: false,
    }),
  );
}
main().catch((error: unknown) => {
  const known =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "RPC_OR_EXECUTION_FAILURE";
  console.error(
    JSON.stringify({
      phase,
      error: known,
      recovery:
        "Resume using the private journal; do not repeat with a new nonce.",
    }),
  );
  process.exitCode = 1;
});
