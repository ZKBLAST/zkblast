import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  concatHex,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  numberToHex,
  publicActions,
  size,
  walletActions,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getMultiSendCallOnlyDeployment } from "@safe-global/safe-deployments";
import { prepareSafeOperation } from "./safe-operation.js";

const redact = (value: unknown) => {
  let text =
    value instanceof Error ? (value.stack ?? value.message) : String(value);
  for (const secret of [
    process.env.RPC_URL,
    process.env.DEPLOYER_PRIVATE_KEY,
    process.env.GOVERNANCE_PRIVATE_KEY,
  ]) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  return text;
};
process.on("unhandledRejection", (reason) => {
  console.error(redact(reason));
  process.exitCode = 1;
});
process.on("uncaughtException", (error) => {
  console.error(redact(error));
  process.exitCode = 1;
});

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex } }>;
type Plan = Readonly<{
  referenceBlock: string;
  deployer: Address;
  startingNonce: number;
  transactionCount: number;
  addresses: Record<string, Address>;
  governance: { admin: Address; upgrader: Address };
  dependencies: { quoteToken: Address; poolFactory: Address };
  configuration: readonly Readonly<{ name: string; to: Address; data: Hex }>[];
  authorization: { planSha256: string };
}>;
const root = path.resolve(import.meta.dirname, "../../..");
const broadcast = process.argv.includes("--broadcast");
const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet")
  throw new Error("DBC_SIMULATION_ENV_INVALID");
const expectedChainId = environment === "mainnet" ? 4663 : 46630;
if (Number(process.env.CHAIN_ID) !== expectedChainId || !process.env.RPC_URL)
  throw new Error("DBC_SIMULATION_ENV_INVALID");
const plan = JSON.parse(
  await readFile(
    path.join(root, `deployments/${environment}/dbc-v1-plan.json`),
    "utf8",
  ),
) as Plan;
const port = 18547,
  local = `http://127.0.0.1:${port}`;
const anvil = broadcast
  ? null
  : spawn(
      "/Users/devmti/.foundry/bin/anvil",
      [
        "--fork-url",
        process.env.RPC_URL,
        "--fork-block-number",
        plan.referenceBlock,
        "--chain-id",
        "31337",
        "--port",
        String(port),
        "--auto-impersonate",
        "--silent",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
let anvilError = "";
anvil?.stderr.on("data", (chunk) => {
  anvilError += String(chunk).replaceAll(
    process.env.RPC_URL!,
    "[RPC_REDACTED]",
  );
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  if (!broadcast) {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const probe = createPublicClient({ transport: http(local) });
        await probe.getBlockNumber();
        ready = true;
        break;
      } catch {
        await sleep(250);
      }
    }
    if (!ready) throw new Error(`DBC_ANVIL_START_FAILED ${anvilError}`);
  }
  const deployer = getAddress(plan.deployer),
    admin = getAddress(plan.governance.admin),
    upgrader = getAddress(plan.governance.upgrader);
  const transport = http(broadcast ? process.env.RPC_URL : local, {
    timeout: 30_000,
    retryCount: 1,
  });
  const publicClient = createPublicClient({ transport });
  const test = broadcast
    ? null
    : createTestClient({ chain: foundry, mode: "anvil", transport })
        .extend(publicActions)
        .extend(walletActions);
  if (test)
    await Promise.all([
      test.setBalance({ address: deployer, value: 10n ** 20n }),
      test.setBalance({ address: admin, value: 10n ** 20n }),
    ]);
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined,
    governanceKey = process.env.GOVERNANCE_PRIVATE_KEY as Hex | undefined;
  const deployerAccount =
    broadcast && deployerKey ? privateKeyToAccount(deployerKey) : null;
  const governanceAccount =
    broadcast && environment === "testnet" && governanceKey
      ? privateKeyToAccount(governanceKey)
      : null;
  if (
    broadcast &&
    (!deployerAccount ||
      (environment === "testnet" && !governanceAccount) ||
      getAddress(deployerAccount.address) !== deployer ||
      (environment === "testnet" &&
        getAddress(governanceAccount!.address) !== admin))
  )
    throw new Error("DBC_SIGNER_MISMATCH");
  const deployerWallet = deployerAccount
    ? createWalletClient({ account: deployerAccount, transport })
    : null;
  const governanceWallet = governanceAccount
    ? createWalletClient({ account: governanceAccount, transport })
    : null;
  const artifact = async (source: string, name = source) =>
    JSON.parse(
      await readFile(
        path.join(
          root,
          "packages/contracts/out",
          `${source}.sol`,
          `${name}.json`,
        ),
        "utf8",
      ),
    ) as Artifact;
  const builds = {
    registry: await artifact("LaunchConfigRegistry"),
    tokenDeployer: await artifact("LaunchTokenDeployer"),
    poolDeployer: await artifact("VirtualPoolDeployer"),
    factory: await artifact("LaunchFactory"),
    router: await artifact("LaunchpadRouter"),
    escrow: await artifact("LPAllocationEscrow"),
    manager: await artifact("GraduationManager"),
    quoter: await artifact("CurveQuoter"),
    adapter: await artifact("DammGraduationAdapter"),
    proxy: await artifact("ERC1967Proxy"),
  };
  const init = (build: Artifact, args: readonly unknown[]) =>
    encodeFunctionData({ abi: build.abi, functionName: "initialize", args });
  const initialization = {
    registry: init(builds.registry, [admin, upgrader, admin]),
    factory: init(builds.factory, [
      admin,
      upgrader,
      plan.addresses.configRegistry,
      plan.addresses.launchTokenDeployer,
      plan.addresses.virtualPoolDeployer,
    ]),
    router: init(builds.router, [
      admin,
      upgrader,
      plan.addresses.launchFactory,
    ]),
    escrow: init(builds.escrow, [admin, upgrader]),
    manager: init(builds.manager, [
      admin,
      upgrader,
      plan.addresses.launchFactory,
      plan.addresses.lpAllocationEscrow,
    ]),
  };
  const deployments = [
    ["configRegistryImplementation", builds.registry.bytecode.object],
    [
      "configRegistry",
      encodeDeployData({
        abi: builds.proxy.abi,
        bytecode: builds.proxy.bytecode.object,
        args: [
          plan.addresses.configRegistryImplementation,
          initialization.registry,
        ],
      }),
    ],
    [
      "launchTokenDeployer",
      encodeDeployData({
        abi: builds.tokenDeployer.abi,
        bytecode: builds.tokenDeployer.bytecode.object,
        args: [admin],
      }),
    ],
    [
      "virtualPoolDeployer",
      encodeDeployData({
        abi: builds.poolDeployer.abi,
        bytecode: builds.poolDeployer.bytecode.object,
        args: [admin],
      }),
    ],
    ["launchFactoryImplementation", builds.factory.bytecode.object],
    [
      "launchFactory",
      encodeDeployData({
        abi: builds.proxy.abi,
        bytecode: builds.proxy.bytecode.object,
        args: [
          plan.addresses.launchFactoryImplementation,
          initialization.factory,
        ],
      }),
    ],
    ["launchpadRouterImplementation", builds.router.bytecode.object],
    [
      "launchpadRouter",
      encodeDeployData({
        abi: builds.proxy.abi,
        bytecode: builds.proxy.bytecode.object,
        args: [
          plan.addresses.launchpadRouterImplementation,
          initialization.router,
        ],
      }),
    ],
    ["lpAllocationEscrowImplementation", builds.escrow.bytecode.object],
    [
      "lpAllocationEscrow",
      encodeDeployData({
        abi: builds.proxy.abi,
        bytecode: builds.proxy.bytecode.object,
        args: [
          plan.addresses.lpAllocationEscrowImplementation,
          initialization.escrow,
        ],
      }),
    ],
    ["graduationManagerImplementation", builds.manager.bytecode.object],
    [
      "graduationManager",
      encodeDeployData({
        abi: builds.proxy.abi,
        bytecode: builds.proxy.bytecode.object,
        args: [
          plan.addresses.graduationManagerImplementation,
          initialization.manager,
        ],
      }),
    ],
    ["curveQuoter", builds.quoter.bytecode.object],
    [
      "dammGraduationAdapter",
      encodeDeployData({
        abi: builds.adapter.abi,
        bytecode: builds.adapter.bytecode.object,
        args: [plan.addresses.graduationManager, plan.dependencies.poolFactory],
      }),
    ],
  ] as const;
  const maximumFeeWei =
    environment === "mainnet" ? 700_000_000_000_000n : 455_147_040_000_000n;
  if (broadcast) {
    if ((await publicClient.getChainId()) !== expectedChainId)
      throw new Error("DBC_BROADCAST_CHAIN_MISMATCH");
    const [nonce, gasPrice, deployerBalance, adminBalance, codes] =
      await Promise.all([
        publicClient.getTransactionCount({
          address: deployer,
          blockTag: "pending",
        }),
        publicClient.getGasPrice(),
        publicClient.getBalance({ address: deployer }),
        publicClient.getBalance({ address: admin }),
        Promise.all(
          Object.values(plan.addresses).map((address) =>
            publicClient.getCode({ address }),
          ),
        ),
      ]);
    if (nonce !== plan.startingNonce)
      throw new Error("DBC_DEPLOYER_NONCE_CHANGED");
    if (codes.some((code) => code && code !== "0x"))
      throw new Error("DBC_PREDICTED_ADDRESS_OCCUPIED");
    const simulation = JSON.parse(
      await readFile(
        path.join(root, `deployments/${environment}/dbc-v1-simulation.json`),
        "utf8",
      ),
    ) as {
      planSha256: string;
      suggestedGasLimit: string;
      totalGasUsed: string;
    };
    if (simulation.planSha256 !== plan.authorization.planSha256)
      throw new Error("DBC_SIMULATION_PLAN_MISMATCH");
    const projected =
      environment === "mainnet"
        ? (BigInt(simulation.totalGasUsed) * gasPrice * 190n + 99n) / 100n
        : BigInt(simulation.suggestedGasLimit) * gasPrice * 2n;
    if (projected > maximumFeeWei) throw new Error("DBC_FEE_CEILING_EXCEEDED");
    if (
      deployerBalance < maximumFeeWei ||
      (environment === "testnet" && adminBalance < maximumFeeWei)
    )
      throw new Error("DBC_SIGNER_BALANCE_INSUFFICIENT");
  }
  const stages: {
    stage: string;
    gasUsed: string;
    fundingAccount: Address;
    transactionHash: Hex;
    blockNumber: string;
    effectiveGasPriceWei: string;
  }[] = [];
  async function send(
    stage: string,
    account: Address,
    request: { data: Hex; to?: Address },
  ) {
    let hash: Hex;
    if (test) {
      hash = await test.sendTransaction({
        account,
        ...request,
        gas: 30_000_000n,
      });
    } else {
      const wallet = account === deployer ? deployerWallet : governanceWallet;
      if (!wallet) throw new Error("DBC_WALLET_UNAVAILABLE");
      const estimate = await publicClient.estimateGas({ account, ...request });
      hash = await wallet.sendTransaction({
        ...request,
        chain: null,
        gas: (estimate * 125n + 99n) / 100n,
      });
    }
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: broadcast ? 2 : 1,
      timeout: 180_000,
    });
    if (receipt.status !== "success")
      throw new Error(`DBC_SIMULATION_REVERT_${stage}`);
    stages.push({
      stage,
      gasUsed: receipt.gasUsed.toString(),
      fundingAccount: account,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    });
    return receipt;
  }
  for (const [stage, data] of deployments) {
    const receipt = await send(`deploy-${stage}`, deployer, { data });
    if (
      receipt.contractAddress?.toLowerCase() !==
      plan.addresses[stage]!.toLowerCase()
    )
      throw new Error(`DBC_PREDICTED_ADDRESS_MISMATCH_${stage}`);
  }
  if (broadcast && environment === "mainnet") {
    const multi = getMultiSendCallOnlyDeployment({
      network: String(expectedChainId),
    });
    const registered = multi?.networkAddresses[String(expectedChainId)];
    const multiCodeHash = multi?.deployments.canonical?.codeHash;
    if (!multi || !registered || !multiCodeHash)
      throw new Error("DBC_MULTISEND_UNAVAILABLE");
    const multiAddress = getAddress(registered);
    const multiCode = await publicClient.getCode({ address: multiAddress });
    if (!multiCode || keccak256(multiCode) !== multiCodeHash)
      throw new Error("DBC_MULTISEND_CODE_MISMATCH");
    const packed = concatHex(
      plan.configuration.map((item) =>
        concatHex([
          numberToHex(0, { size: 1 }),
          item.to,
          numberToHex(0, { size: 32 }),
          numberToHex(size(item.data), { size: 32 }),
          item.data,
        ]),
      ),
    );
    const multiData = encodeFunctionData({
      abi: multi.abi,
      functionName: "multiSend",
      args: [packed],
    });
    const operation = await prepareSafeOperation(publicClient, {
      chainId: expectedChainId,
      safe: admin,
      to: multiAddress,
      data: multiData,
      operation: 1,
      relayer: deployer,
    });
    await send("configure-safe-multisend", deployer, {
      to: operation.to,
      data: operation.data,
    });
  } else {
    for (const item of plan.configuration)
      await send(`configure-${item.name}`, admin, {
        to: item.to,
        data: item.data,
      });
  }
  const expectedTransactions =
    broadcast && environment === "mainnet"
      ? deployments.length + 1
      : plan.transactionCount;
  if (stages.length !== expectedTransactions)
    throw new Error("DBC_TRANSACTION_COUNT_MISMATCH");
  const live = createPublicClient({
    transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
  });
  const gasPrice = await live.getGasPrice();
  const totalGas = stages.reduce((sum, item) => sum + BigInt(item.gasUsed), 0n);
  const bufferedGas = (totalGas * 125n + 99n) / 100n;
  const report = {
    schemaVersion: 1,
    environment,
    chainId: expectedChainId,
    simulatedChainId: broadcast ? undefined : 31337,
    referenceBlock: plan.referenceBlock,
    planSha256: plan.authorization.planSha256,
    transactionCount: stages.length,
    actionCount: plan.transactionCount,
    totalGasUsed: totalGas.toString(),
    gasPriceWei: gasPrice.toString(),
    estimatedFeeETH: formatEther(totalGas * gasPrice),
    suggestedGasLimit: bufferedGas.toString(),
    suggestedGasPriceCapWei: (gasPrice * 2n).toString(),
    suggestedFeeCeilingETH: formatEther(bufferedGas * gasPrice * 2n),
    stages,
    totalFeeWei: stages
      .reduce(
        (sum, item) =>
          sum + BigInt(item.gasUsed) * BigInt(item.effectiveGasPriceWei),
        0n,
      )
      .toString(),
    liveBroadcast: broadcast,
  };
  if (broadcast && BigInt(report.totalFeeWei) > maximumFeeWei)
    throw new Error("DBC_ACTUAL_FEE_CEILING_EXCEEDED");
  await writeFile(
    path.join(
      root,
      `deployments/${environment}/${broadcast ? "dbc-v1-deployment" : "dbc-v1-simulation"}.json`,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o644 },
  );
  if (broadcast) {
    const manifestPath = path.join(
      root,
      `deployments/${environment}/manifest.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dbc = {
      abiVersion: 1,
      deploymentBlock: Number(stages[0]!.blockNumber),
      configRegistry: plan.addresses.configRegistry,
      launchTokenDeployer: plan.addresses.launchTokenDeployer,
      virtualPoolDeployer: plan.addresses.virtualPoolDeployer,
      launchFactory: plan.addresses.launchFactory,
      curveQuoter: plan.addresses.curveQuoter,
      launchpadRouter: plan.addresses.launchpadRouter,
      graduationManager: plan.addresses.graduationManager,
      dammGraduationAdapter: plan.addresses.dammGraduationAdapter,
      lpAllocationEscrow: plan.addresses.lpAllocationEscrow,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...report, stages: undefined }, null, 2));
} finally {
  anvil?.kill("SIGTERM");
}
