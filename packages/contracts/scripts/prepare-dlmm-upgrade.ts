import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  getAddress,
  getContractAddress,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  zeroHash,
  toHex,
  type Abi,
  type Address,
  type Hex,
  formatUnits,
  parseUnits,
} from "viem";
import { prepareSafeOperation } from "./safe-operation.js";
import { observeDlmmReference } from "./dlmm-reference-price.js";
import { initialBinForHumanPrice } from "./dlmm-bin-math.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function schedule(address target,uint256 value,bytes data,bytes32 predecessor,bytes32 salt,uint256 delay)",
  "function execute(address target,uint256 value,bytes data,bytes32 predecessor,bytes32 salt) payable returns (bytes)",
]);
const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)",
]);

function requireValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function save(file: string, value: unknown) {
  const destination = path.join(root, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(`${destination}.tmp`, destination);
}

async function main() {
  check(
    requireValue("APP_ENV") === "mainnet",
    "Mainnet configuration required",
  );
  check(Number(requireValue("CHAIN_ID")) === 4663, "Chain 4663 required");
  const rehearsal = process.argv.includes("--rehearse");
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "deployments/mainnet/manifest.json"),
      "utf8",
    ),
  ) as {
    deployerAddress: Address;
    contracts: {
      PoolFactory: {
        proxyAddress: Address;
        implementationAddress: Address;
        governanceAddress: Address;
        upgraderAddress: Address;
      };
    };
    integration: { poolRegistry: Address };
  };
  const artifact = JSON.parse(
    await readFile(
      path.join(
        root,
        "packages/contracts/out/PoolFactory.sol/PoolFactory.json",
      ),
      "utf8",
    ),
  ) as {
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: { object: Hex };
  };
  const {
    proxyAddress: proxy,
    governanceAddress: safe,
    upgraderAddress: timelock,
  } = manifest.contracts.PoolFactory;
  const rpc = requireValue("RPC_URL");
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const live = createPublicClient({ chain, transport: http(rpc) });
  check((await live.getChainId()) === 4663, "RPC chain mismatch");
  const [
    block,
    nonce,
    safeNonce,
    threshold,
    delay,
    implementationSlot,
    balance,
    gasPrice,
  ] = await Promise.all([
    live.getBlockNumber(),
    live.getTransactionCount({
      address: manifest.deployerAddress,
      blockTag: "pending",
    }),
    live.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
    live.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getThreshold",
    }),
    live.readContract({
      address: timelock,
      abi: timelockAbi,
      functionName: "getMinDelay",
    }),
    live.getStorageAt({ address: proxy, slot }),
    live.getBalance({ address: manifest.deployerAddress }),
    live.getGasPrice(),
  ]);
  check(threshold === 2n && delay === 300n, "Governance policy mismatch");
  const previousImplementation = getAddress(
    `0x${implementationSlot?.slice(-40)}`,
  );
  check(
    previousImplementation ===
      getAddress(manifest.contracts.PoolFactory.implementationAddress),
    "Implementation drift",
  );
  for (const role of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
    check(
      await live.readContract({
        address: timelock,
        abi: timelockAbi,
        functionName: "hasRole",
        args: [keccak256(toHex(role)), safe],
      }),
      `Safe missing ${role}`,
    );
  }
  const newImplementation = getContractAddress({
    from: manifest.deployerAddress,
    nonce: BigInt(nonce),
  });
  const calldata = encodeFunctionData({
    abi: artifact.abi,
    functionName: "upgradeToAndCall",
    args: [newImplementation, "0x"],
  });
  const creationCodeHash = keccak256(artifact.bytecode.object);
  const salt = keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
      ],
      ["ZKBLAST_DLMM_FACTORY_V2", 4663n, proxy, creationCodeHash],
    ),
  );
  const operation = [proxy, 0n, calldata, zeroHash, salt] as const;
  const operationId = keccak256(
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
  );
  const scheduleCalldata = encodeFunctionData({
    abi: timelockAbi,
    functionName: "schedule",
    args: [...operation, delay],
  });
  const executeCalldata = encodeFunctionData({
    abi: timelockAbi,
    functionName: "execute",
    args: operation,
  });
  const tokenA = getAddress(requireValue("EXECUTION_WETH_ADDRESS"));
  const tokenB = getAddress(requireValue("EXECUTION_USDG_ADDRESS"));
  const token0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
  const token1 = token0 === tokenA ? tokenB : tokenA;
  const erc20 = parseAbi([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]);
  const [symbolA, symbolB, decimalsA, decimalsB, reference] = await Promise.all(
    [
      live.readContract({
        address: tokenA,
        abi: erc20,
        functionName: "symbol",
      }),
      live.readContract({
        address: tokenB,
        abi: erc20,
        functionName: "symbol",
      }),
      live.readContract({
        address: tokenA,
        abi: erc20,
        functionName: "decimals",
      }),
      live.readContract({
        address: tokenB,
        abi: erc20,
        functionName: "decimals",
      }),
      observeDlmmReference(),
    ],
  );
  check(
    symbolA === "WETH" && symbolB === "USDG",
    "Execution asset identity mismatch",
  );
  const humanPrice =
    token0 === tokenA
      ? reference.wethPriceUsdg
      : formatUnits(10n ** 36n / parseUnits(reference.wethPriceUsdg, 18), 18);
  const selectedBin = initialBinForHumanPrice(
    humanPrice,
    token0 === tokenA ? decimalsA : decimalsB,
    token0 === tokenA ? decimalsB : decimalsA,
    25,
  );
  check(
    selectedBin.deviationBps <= 13,
    "Initial bin price deviation exceeds half step",
  );
  const plan = {
    schemaVersion: 1,
    protocol: "ZKBLAST",
    environment: "mainnet",
    chainId: 4663,
    observedBlock: block.toString(),
    deployer: manifest.deployerAddress,
    deployerNonce: nonce,
    balanceWei: balance.toString(),
    safe,
    safeNonce: safeNonce.toString(),
    timelock,
    delaySeconds: Number(delay),
    proxy,
    previousImplementation,
    newImplementation,
    creationCodeHash,
    runtimeTemplateHash: keccak256(artifact.deployedBytecode.object),
    calldata,
    calldataHash: keccak256(calldata),
    predecessor: zeroHash,
    salt,
    operationId,
    scheduleCalldata,
    executeCalldata,
    observedGasPriceWei: gasPrice.toString(),
    gasLimits: { deploy: "6000000", schedule: "400000", execute: "600000" },
    maxFeePerGasWei: (gasPrice * 3n).toString(),
    maxTotalUpgradeFeeWei: (7_000_000n * gasPrice * 3n).toString(),
    dlmmPreview: {
      token0,
      token1,
      feePips: 3000,
      binStepBps: 25,
      initialActiveBin: selectedBin.binId,
      priceDeviationBps: selectedBin.deviationBps,
      reference,
      requiresFreshReferenceBeforePoolBroadcast: true,
    },
    scope:
      "PoolFactory implementation upgrade only; pool liquidity is a separate action",
  };
  const planHash = keccak256(toHex(JSON.stringify(plan)));
  await save("deployments/mainnet/dlmm-upgrade-plan.json", {
    ...plan,
    planHash,
  });
  console.log(JSON.stringify({ ...plan, planHash }, null, 2));
  if (!rehearsal) return;

  const localUrl = requireValue("DLMM_REHEARSAL_RPC_URL");
  const local = new URL(localUrl);
  check(
    ["127.0.0.1", "localhost", "[::1]"].includes(local.hostname),
    "Rehearsal must use localhost",
  );
  const client = createPublicClient({ chain, transport: http(localUrl) });
  // Raw Anvil methods are deliberately confined to the localhost-only transport.
  const request = client.request as unknown as (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  await request({
    method: "anvil_reset",
    params: [{ forking: { jsonRpcUrl: rpc, blockNumber: Number(block) } }],
  });
  check((await client.getChainId()) === 4663, "Fork chain mismatch");
  for (const account of [manifest.deployerAddress, safe]) {
    await request({ method: "anvil_impersonateAccount", params: [account] });
    await request({
      method: "anvil_setBalance",
      params: [account, toHex(10n ** 19n)],
    });
  }
  const deployer = createWalletClient({
    account: manifest.deployerAddress,
    chain,
    transport: http(localUrl),
  });
  const governance = createWalletClient({
    account: manifest.deployerAddress,
    chain,
    transport: http(localUrl),
  });
  const safeTransactions: { nonce: string; safeTransactionHash: Hex }[] = [];
  const executeSafe = async (to: Address, data: Hex) => {
    const prepared = await prepareSafeOperation(client, {
      chainId: 4663,
      safe,
      to,
      data,
      relayer: manifest.deployerAddress,
    });
    safeTransactions.push({
      nonce: prepared.nonce.toString(),
      safeTransactionHash: prepared.hash,
    });
    return governance.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      gas: 3_000_000n,
    });
  };
  const receipts: {
    hash: Hex;
    blockNumber: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    totalFeeWei: string;
  }[] = [];
  const wait = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    check(receipt.status === "success", "Fork transaction reverted");
    receipts.push({
      hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    });
    return receipt;
  };
  const deployment = await wait(
    await deployer.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      nonce,
    }),
  );
  check(
    deployment.contractAddress &&
      getAddress(deployment.contractAddress) === newImplementation,
    "Predicted implementation mismatch",
  );
  const registryBefore = await client.readContract({
    address: proxy,
    abi: artifact.abi,
    functionName: "registry",
  });
  await wait(await executeSafe(timelock, scheduleCalldata));
  let prematureRejected = false;
  try {
    await client.simulateContract({
      account: safe,
      address: timelock,
      abi: timelockAbi,
      functionName: "execute",
      args: operation,
    });
  } catch {
    prematureRejected = true;
  }
  check(prematureRejected, "Timelock executed prematurely");
  await request({ method: "evm_increaseTime", params: [Number(delay) + 1] });
  await request({ method: "evm_mine", params: [] });
  await wait(await executeSafe(timelock, executeCalldata));
  const updatedSlot = await client.getStorageAt({ address: proxy, slot });
  check(
    getAddress(`0x${updatedSlot?.slice(-40)}`) === newImplementation,
    "Upgrade slot mismatch",
  );
  const registryAfter = await client.readContract({
    address: proxy,
    abi: artifact.abi,
    functionName: "registry",
  });
  check(registryBefore === registryAfter, "Registry storage changed");
  const bin = selectedBin.binId;
  check(
    Number.isInteger(bin) && bin >= -10000 && bin <= 10000,
    "Invalid rehearsal bin",
  );
  const poolKey = { token0, token1, model: 1, feePips: 3000, binStepBps: 25 };
  const predictedPool = (await client.readContract({
    address: proxy,
    abi: artifact.abi,
    functionName: "predictDlmmPoolAddress",
    args: [poolKey, safe, bin],
  })) as Address;
  await wait(
    await executeSafe(
      proxy,
      encodeFunctionData({
        abi: artifact.abi,
        functionName: "createDlmmPool",
        args: [token0, token1, 3000, 25, bin],
      }),
    ),
  );
  const poolAbi = parseAbi([
    "function activeBin() view returns (int24)",
    "function binStepBps() view returns (uint16)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
  ]);
  check(
    (await client.readContract({
      address: predictedPool,
      abi: poolAbi,
      functionName: "activeBin",
    })) === bin,
    "Active bin mismatch",
  );
  check(
    (await client.readContract({
      address: predictedPool,
      abi: poolAbi,
      functionName: "binStepBps",
    })) === 25,
    "Bin step mismatch",
  );
  const registered = await client.readContract({
    address: manifest.integration.poolRegistry,
    abi: parseAbi(["function isRegisteredPool(address) view returns (bool)"]),
    functionName: "isRegisteredPool",
    args: [predictedPool],
  });
  check(registered, "DLMM pool not registered");
  await save("docs/evidence/mainnet/dlmm-upgrade-rehearsal.json", {
    planHash,
    forkOnly: true,
    forkBlock: block.toString(),
    safeSignaturesVerified: true,
    safeTransactions,
    prematureRejected,
    registryPreserved: registryBefore === registryAfter,
    predictedPool,
    activeBin: bin,
    receipts,
  });
  console.log(
    `Fork rehearsal passed: implementation ${newImplementation}, DLMM ${predictedPool}, bin ${bin}`,
  );
}

main().catch((error: unknown) => {
  // viem transport errors include credential-bearing RPC URLs; never serialize them.
  console.error(
    error instanceof Error
      ? error.message.split("\n")[0]
      : "DLMM preparation failed",
  );
  process.exitCode = 1;
});
