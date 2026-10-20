import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  decodeEventLog,
  keccak256,
  parseUnits,
  formatUnits,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { observeDlmmReference } from "./dlmm-reference-price.js";
import { initialBinForHumanPrice, priceFromBin } from "./dlmm-bin-math.js";
import { parseDeploymentManifest } from "../../config/src/deployment.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function required(name: string) {
  const value = process.env[name]?.trim();
  check(value, `Missing ${name}`);
  return value;
}
function account(name: string) {
  const key = required(name);
  check(/^0x[\da-f]{64}$/iu.test(key), `Invalid ${name}`);
  return privateKeyToAccount(key as Hex);
}
async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    `${file}.tmp`,
    `${JSON.stringify(value, (_, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`,
    { mode: 0o600 },
  );
  await rename(`${file}.tmp`, file);
}
type ReceiptRecord = {
  hash: Hex;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
};
type Journal = {
  chainId: number;
  initialBin?: number;
  pool?: Address;
  implementation?: Address;
  reference?: unknown;
  steps: Record<string, { hash: Hex; receipt?: ReceiptRecord }>;
};
type Manifest = {
  chainId: number;
  environment: string;
  deployerAddress: Address;
  governanceAddress: Address;
  upgraderAddress: Address;
  contracts: {
    PoolFactory: {
      proxyAddress: Address;
      implementationAddress: Address;
      upgrades?: unknown[];
      artifactBytecodeHash: Hex;
      deployedRuntimeBytecodeHash: Hex;
      verification: unknown;
    };
  };
  integration: {
    poolRegistry: Address;
    poolFactory: Address;
    poolQuoter: Address;
    swapRouter: Address;
    positionManager: Address;
  };
  generatedAt: string;
  totals: { transactionCount: number; gasUsed: string; totalFeeWei: string };
};

async function main() {
  check(
    required("APP_ENV") === "testnet" && required("CHAIN_ID") === "46630",
    "Testnet chain 46630 required",
  );
  const broadcast =
    process.env.CONFIRM_TESTNET_DLMM_ACTIVATION ===
    "ACTIVATE_ZKBLAST_TESTNET_DLMM";
  const manifestFile = path.join(root, "deployments/testnet/manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
  check(
    manifest.chainId === 46630 && manifest.environment === "testnet",
    "Manifest mismatch",
  );
  const deployer = account("DEPLOYER_PRIVATE_KEY");
  const upgrader = account("UPGRADER_PRIVATE_KEY");
  const governor = account("GOVERNANCE_PRIVATE_KEY");
  check(
    deployer.address === getAddress(manifest.deployerAddress),
    "Deployer identity mismatch",
  );
  check(
    upgrader.address === getAddress(manifest.upgraderAddress),
    "Upgrader identity mismatch",
  );
  check(
    governor.address === getAddress(manifest.governanceAddress),
    "Governance identity mismatch",
  );
  const rpc = required("RPC_URL");
  const chain = defineChain({
    id: 46630,
    name: required("CHAIN_NAME"),
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(rpc) });
  check((await client.getChainId()) === 46630, "RPC chain mismatch");
  const deployWallet = createWalletClient({
    account: deployer,
    chain,
    transport: http(rpc),
  });
  const upgradeWallet = createWalletClient({
    account: upgrader,
    chain,
    transport: http(rpc),
  });
  const wallet = createWalletClient({
    account: governor,
    chain,
    transport: http(rpc),
  });
  const artifact = async (name: string) =>
    JSON.parse(
      await readFile(
        path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    ) as {
      abi: Abi;
      bytecode: { object: Hex };
      deployedBytecode: { object: Hex };
    };
  const [
    factoryArtifact,
    poolArtifact,
    managerArtifact,
    routerArtifact,
    quoterArtifact,
  ] = await Promise.all(
    [
      "PoolFactory",
      "DlmmPool",
      "PositionManager",
      "SwapRouter",
      "PoolQuoter",
    ].map(artifact),
  );
  check(
    factoryArtifact &&
      poolArtifact &&
      managerArtifact &&
      routerArtifact &&
      quoterArtifact,
    "Artifacts missing",
  );
  const factory = getAddress(manifest.integration.poolFactory);
  const manager = getAddress(manifest.integration.positionManager);
  const router = getAddress(manifest.integration.swapRouter);
  const weth = getAddress(required("EXECUTION_WETH_ADDRESS"));
  const usdg = getAddress(required("EXECUTION_USDG_ADDRESS"));
  const token0 = weth.toLowerCase() < usdg.toLowerCase() ? weth : usdg;
  const token1 = token0 === weth ? usdg : weth;
  const erc20 = parseAbi([
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function deposit() payable",
  ]);
  const [
    wethSymbol,
    usdgSymbol,
    wethDecimals,
    usdgDecimals,
    nativeBalance,
    wethBalance,
    usdgBalance,
    reference,
  ] = await Promise.all([
    client.readContract({ address: weth, abi: erc20, functionName: "symbol" }),
    client.readContract({ address: usdg, abi: erc20, functionName: "symbol" }),
    client.readContract({
      address: weth,
      abi: erc20,
      functionName: "decimals",
    }),
    client.readContract({
      address: usdg,
      abi: erc20,
      functionName: "decimals",
    }),
    client.getBalance({ address: governor.address }),
    client.readContract({
      address: weth,
      abi: erc20,
      functionName: "balanceOf",
      args: [governor.address],
    }),
    client.readContract({
      address: usdg,
      abi: erc20,
      functionName: "balanceOf",
      args: [governor.address],
    }),
    observeDlmmReference(),
  ]);
  check(
    wethSymbol === "WETH" &&
      usdgSymbol === "USDG" &&
      wethDecimals === 18 &&
      usdgDecimals === 6,
    "Asset identity/decimals mismatch",
  );
  check(
    nativeBalance > parseUnits("0.001", 18),
    "Governance wallet needs testnet gas",
  );
  check(
    usdgBalance >= parseUnits("1", 6),
    "Governance wallet needs at least 1 testnet USDG",
  );
  if (wethBalance < parseUnits("0.0001", 18)) {
    await client.simulateContract({
      account: governor,
      address: weth,
      abi: erc20,
      functionName: "deposit",
      value: parseUnits("0.0001", 18) - wethBalance,
    });
  }
  const roleAbi = parseAbi([
    "function hasRole(bytes32,address) view returns (bool)",
  ]);
  check(
    await client.readContract({
      address: factory,
      abi: roleAbi,
      functionName: "hasRole",
      args: [`0x${"00".repeat(32)}`, governor.address],
    }),
    "Governance admin role missing",
  );
  check(
    await client.readContract({
      address: factory,
      abi: roleAbi,
      functionName: "hasRole",
      args: [
        keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
        upgrader.address,
      ],
    }),
    "Upgrader role missing",
  );
  const humanPrice =
    token0 === weth
      ? reference.wethPriceUsdg
      : formatUnits(10n ** 36n / parseUnits(reference.wethPriceUsdg, 18), 18);
  const initial = initialBinForHumanPrice(
    humanPrice,
    token0 === weth ? 18 : 6,
    token1 === usdg ? 6 : 18,
    25,
  );
  const journalFile = path.join(
    root,
    "deployments/testnet/dlmm-activation.private.json",
  );
  const journal = await readFile(journalFile, "utf8")
    .then((data) => JSON.parse(data) as Journal)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { chainId: 46630, steps: {} } as Journal;
    });
  check(journal.chainId === 46630, "Journal chain mismatch");
  console.log(
    JSON.stringify(
      {
        chainId: 46630,
        factory,
        governor: governor.address,
        initialBin: journal.initialBin ?? initial.binId,
        nativeBalance: formatUnits(nativeBalance, 18),
        wethBalance: wethBalance.toString(),
        usdgBalance: usdgBalance.toString(),
        maximumWethWrap: "0.0001",
        broadcast,
      },
      null,
      2,
    ),
  );
  if (!broadcast) return;
  const wait = async (step: string, hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    check(receipt.status === "success", `${step} reverted; inspect journal`);
    journal.steps[step] = {
      hash,
      receipt: {
        hash,
        contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
        blockNumber: Number(receipt.blockNumber),
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
        status: "success",
      },
    };
    await save(journalFile, journal);
    console.log(`${step}: ${hash} (${receipt.gasUsed} gas)`);
    return receipt;
  };
  const send = async (step: string, sendTransaction: () => Promise<Hex>) => {
    const old = journal.steps[step];
    if (old) return wait(step, old.hash);
    const hash = await sendTransaction();
    journal.steps[step] = { hash };
    await save(journalFile, journal);
    return wait(step, hash);
  };
  const fee = async () => ({
    maxFeePerGas: (await client.getGasPrice()) * 3n,
    maxPriorityFeePerGas: 0n,
  });
  const call = async (
    step: string,
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    value = 0n,
  ) =>
    send(step, async () => {
      await client.simulateContract({
        account: governor,
        address,
        abi,
        functionName,
        args,
        value,
      });
      return wallet.writeContract({
        address,
        abi,
        functionName,
        args,
        value,
        gas: 3_000_000n,
        ...(await fee()),
      });
    });
  const implementationReceipt = await send("deployImplementation", async () =>
    deployWallet.deployContract({
      abi: factoryArtifact.abi,
      bytecode: factoryArtifact.bytecode.object,
      gas: 6_000_000n,
      ...(await fee()),
    }),
  );
  check(
    implementationReceipt.contractAddress,
    "Implementation address missing",
  );
  journal.implementation = getAddress(implementationReceipt.contractAddress);
  await save(journalFile, journal);
  const upgradeReceipt = await send("upgradeFactory", async () => {
    await client.simulateContract({
      account: upgrader,
      address: factory,
      abi: factoryArtifact.abi,
      functionName: "upgradeToAndCall",
      args: [journal.implementation, "0x"],
    });
    return upgradeWallet.writeContract({
      address: factory,
      abi: factoryArtifact.abi,
      functionName: "upgradeToAndCall",
      args: [journal.implementation, "0x"],
      ...(await fee()),
    });
  });
  const implementationSlot = await client.getStorageAt({
    address: factory,
    slot,
  });
  check(
    getAddress(`0x${implementationSlot?.slice(-40)}`) ===
      journal.implementation,
    "Implementation slot mismatch",
  );
  const deployment = manifest.contracts.PoolFactory;
  if (getAddress(deployment.implementationAddress) !== journal.implementation) {
    deployment.upgrades ??= [];
    deployment.upgrades.push({
      previousImplementationAddress: deployment.implementationAddress,
      newImplementationAddress: journal.implementation,
      implementationDeployment: journal.steps.deployImplementation!.receipt,
      proxyUpgrade: journal.steps.upgradeFactory!.receipt,
    });
    deployment.implementationAddress = journal.implementation;
    deployment.artifactBytecodeHash = keccak256(
      factoryArtifact.deployedBytecode.object,
    );
    deployment.deployedRuntimeBytecodeHash = keccak256(
      (await client.getBytecode({ address: journal.implementation }))!,
    );
    deployment.verification = {
      implementation: "pending",
      proxy: "pending",
      urls: [],
    };
    manifest.totals.transactionCount += 2;
    manifest.totals.gasUsed = (
      BigInt(manifest.totals.gasUsed) +
      implementationReceipt.gasUsed +
      upgradeReceipt.gasUsed
    ).toString();
    manifest.totals.totalFeeWei = (
      BigInt(manifest.totals.totalFeeWei) +
      implementationReceipt.gasUsed * implementationReceipt.effectiveGasPrice +
      upgradeReceipt.gasUsed * upgradeReceipt.effectiveGasPrice
    ).toString();
    manifest.generatedAt = new Date().toISOString();
    parseDeploymentManifest(manifest, { environment: "testnet", chainId: 46630 });
    await save(manifestFile, manifest);
  }
  journal.initialBin ??= initial.binId;
  journal.reference ??= reference;
  const bin = journal.initialBin;
  const key = { token0, token1, model: 1, feePips: 3000, binStepBps: 25 };
  const pool = getAddress(
    (await client.readContract({
      address: factory,
      abi: factoryArtifact.abi,
      functionName: "predictDlmmPoolAddress",
      args: [key, governor.address, bin],
    })) as Address,
  );
  journal.pool = pool;
  await save(journalFile, journal);
  const creation = await call(
    "createPool",
    factory,
    factoryArtifact.abi,
    "createDlmmPool",
    [token0, token1, 3000, 25, bin],
  );
  check(
    await client.readContract({
      address: manifest.integration.poolRegistry,
      abi: parseAbi(["function isRegisteredPool(address) view returns (bool)"]),
      functionName: "isRegisteredPool",
      args: [pool],
    }),
    "Pool not registered",
  );
  check(
    (await client.readContract({
      address: pool,
      abi: poolArtifact.abi,
      functionName: "activeBin",
    })) ===
      (journal.steps.swapCrossBin
        ? await client.readContract({
            address: pool,
            abi: poolArtifact.abi,
            functionName: "activeBin",
          })
        : bin),
    "Initial bin mismatch",
  );
  if (!journal.steps.wrapWeth && wethBalance < parseUnits("0.0001", 18))
    await call(
      "wrapWeth",
      weth,
      erc20,
      "deposit",
      [],
      parseUnits("0.0001", 18) - wethBalance,
    );
  await call("approveWethPositions", weth, erc20, "approve", [
    manager,
    parseUnits("0.00008", 18),
  ]);
  await call("approveUsdgPositions", usdg, erc20, "approve", [
    manager,
    parseUnits("1", 6),
  ]);
  const deadline = async () => (await client.getBlock()).timestamp + 900n;
  const bins = [bin - 1, bin, bin + 1];
  const positionIds: bigint[] = [];
  for (const binId of bins) {
    const price = priceFromBin(binId, 25);
    const amount0 =
      token0 === weth ? parseUnits("0.00002", 18) : parseUnits("0.05", 6);
    const amount1 = (amount0 * price) / 10n ** 18n;
    const receipt = await call(
      `position:${binId}`,
      manager,
      managerArtifact.abi,
      "createDlmmPosition",
      [pool, binId, amount0, amount1, 1n, await deadline()],
    );
    let id: bigint | undefined;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== manager) continue;
      try {
        const event = decodeEventLog({
          abi: managerArtifact.abi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "PositionCreated")
          id = (event.args as unknown as { positionId: bigint }).positionId;
      } catch {
        /* Other manager events. */
      }
    }
    check(id !== undefined, "PositionCreated event missing");
    positionIds.push(id);
  }
  const upperId = positionIds[2]!;
  const upperPrice = priceFromBin(bin + 1, 25);
  const increase0 =
    token0 === weth ? parseUnits("0.000002", 18) : parseUnits("0.005", 6);
  await call(
    "increasePosition",
    manager,
    managerArtifact.abi,
    "increasePosition",
    [
      upperId,
      increase0,
      (increase0 * upperPrice) / 10n ** 18n,
      1n,
      await deadline(),
    ],
  );
  const wethToUsdg = token0 === weth;
  const swapAmount = parseUnits("0.000025", 18);
  await call("approveWethSwap", weth, erc20, "approve", [router, swapAmount]);
  if (!journal.steps.swapCrossBin) {
    const quote = (await client.readContract({
      address: manifest.integration.poolQuoter,
      abi: quoterArtifact.abi,
      functionName: "quoteDlmmExactInput",
      args: [pool, wethToUsdg, swapAmount, 4],
    })) as readonly [bigint, number, number];
    check(
      quote[0] > 0n && quote[1] !== bin && quote[2] > 1,
      "Quote does not cross bins",
    );
    await call(
      "swapCrossBin",
      router,
      routerArtifact.abi,
      "swapDlmmExactInput",
      [
        pool,
        wethToUsdg,
        swapAmount,
        (quote[0] * 99n) / 100n,
        4,
        governor.address,
        await deadline(),
      ],
    );
    check(
      (await client.readContract({
        address: pool,
        abi: poolArtifact.abi,
        functionName: "activeBin",
      })) === quote[1],
      "Quote/execution active bin mismatch",
    );
  }
  if (!journal.steps.decreasePosition) {
    const position = (await client.readContract({
      address: manager,
      abi: managerArtifact.abi,
      functionName: "positions",
      args: [upperId],
    })) as readonly [Address, Address, number, number, bigint];
    const state = (await client.readContract({
      address: pool,
      abi: poolArtifact.abi,
      functionName: "binState",
      args: [bin + 1],
    })) as readonly [bigint, bigint, bigint, bigint];
    const shares = position[4] / 10n;
    await call(
      "decreasePosition",
      manager,
      managerArtifact.abi,
      "decreasePosition",
      [
        upperId,
        shares,
        (((state[0] * shares) / state[2]) * 99n) / 100n,
        (((state[1] * shares) / state[2]) * 99n) / 100n,
        governor.address,
        await deadline(),
      ],
    );
  }
  const activeBin = (await client.readContract({
    address: pool,
    abi: poolArtifact.abi,
    functionName: "activeBin",
  })) as number;
  const binStates = await Promise.all(
    bins.map(async (binId) => ({
      binId,
      state: await client.readContract({
        address: pool,
        abi: poolArtifact.abi,
        functionName: "binState",
        args: [binId],
      }),
    })),
  );
  const tokens = await Promise.all(
    [token0, token1].map(async (address) => ({
      address,
      symbol: await client.readContract({
        address,
        abi: erc20,
        functionName: "symbol",
      }),
      name: await client.readContract({
        address,
        abi: erc20,
        functionName: "name",
      }),
      decimals: await client.readContract({
        address,
        abi: erc20,
        functionName: "decimals",
      }),
    })),
  );
  const market = {
    schemaVersion: 1,
    protocol: "ZKBLAST",
    environment: "testnet",
    chainId: 46630,
    generatedAt: new Date().toISOString(),
    tokens,
    pool: {
      address: pool,
      model: "dlmm",
      factory,
      feePips: 3000,
      feeBps: 30,
      binStepBps: 25,
      initialActiveBin: bin,
      activeBin,
      createdBlock: Number(creation.blockNumber),
      liquidityStatus: "funded",
      binStates,
    },
    positionIds: positionIds.map(String),
    owner: governor.address,
    reference: journal.reference,
    acceptance: {
      add: true,
      increase: true,
      crossBinSwap: true,
      decrease: true,
    },
    transactions: Object.fromEntries(
      Object.entries(journal.steps).map(([name, step]) => [name, step.receipt]),
    ),
  };
  await save(path.join(root, "deployments/testnet/dlmm-market.json"), market);
  console.log(
    `Testnet DLMM acceptance passed: ${pool}, initial bin ${bin}, active bin ${activeBin}`,
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message.split("\n")[0]
      : "Testnet DLMM activation failed",
  );
  process.exitCode = 1;
});
