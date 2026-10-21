import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  getAddress,
  getContractAddress,
  encodeDeployData,
  encodeFunctionData,
  parseAbi,
  keccak256,
  toHex,
  concatHex,
  zeroAddress,
  formatEther,
  type Abi,
  type Address,
  type Hex,
  type StateOverride,
} from "viem";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { startPrivateForkRelay } from "./private-v2-fork-relay.js";
import { normalizeSafeOwners } from "./private-v2-safe-owners.js";

// Every live request is read-only. Transactions are sent exclusively to localhost Anvil.
const root = path.resolve(import.meta.dirname, "../../..");
const contractRoot = path.join(root, "packages/contracts");
const candidateName = process.argv[2];
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
check(
  /^candidate-[\w-]+$/u.test(candidateName ?? ""),
  "EXPLICIT_MAINNET_CANDIDATE_REQUIRED",
);
const directory = path.join(
  root,
  "packages/circuits/target/v2-mainnet",
  candidateName!,
);
const slot: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  metadata: { sources: Record<string, { keccak256: Hex }> };
};
const json = async (filename: string) =>
  JSON.parse(await readFile(filename, "utf8"));
const save = async (filename: string, value: unknown) =>
  writeFile(
    path.join(directory, filename),
    JSON.stringify(value, null, 2) + "\n",
  );
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
let phase = "candidate";
function expectedRuntime(artifact: Artifact, immutable?: Address): Hex {
  let code = artifact.deployedBytecode.object.slice(2);
  for (const refs of Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  )) {
    check(immutable, "IMMUTABLE_REQUIRED");
    for (const ref of refs)
      code =
        code.slice(0, ref.start * 2) +
        BigInt(immutable)
          .toString(16)
          .padStart(ref.length * 2, "0") +
        code.slice((ref.start + ref.length) * 2);
  }
  return `0x${code}`;
}
async function main() {
  check(
    process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL,
    "MAINNET_READ_ONLY_ENV_REQUIRED",
  );
  const candidate = await json(path.join(directory, "candidate.json"));
  check(
    candidate.environment === "mainnet" &&
      candidate.chainId === 4663 &&
      candidate.eligibleForDeployment === false &&
      Object.values(
        candidate.artifacts as Record<string, { testnetKeyReused: boolean }>,
      ).every((a) => !a.testnetKeyReused),
    "ISOLATED_MAINNET_KEYS_REQUIRED",
  );
  const manifestFile = path.join(root, "deployments/mainnet/manifest.json");
  const activeBytes = await readFile(manifestFile);
  const manifest = await loadDeploymentManifestFile(manifestFile, {
    environment: "mainnet",
    chainId: 4663,
  });
  check(manifest.shielded && !manifest.shieldedV2, "ISOLATED_NEW_V2_REQUIRED");
  const safeEvidence = await json(
    path.join(root, "deployments/mainnet/safe.json"),
  );
  const governance = await json(
    path.join(root, "deployments/mainnet/governance.json"),
  );
  const deployer = getAddress(manifest.deployerAddress);
  const safe = getAddress(manifest.roles.defaultAdmin);
  const upgrader = getAddress(manifest.roles.upgrader);
  const registry = getAddress(manifest.integration.poolRegistry);
  const remote = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20000, retryCount: 0 }),
  });
  phase = "live-read-only-snapshot";
  check((await remote.getChainId()) === 4663, "MAINNET_CHAIN_MISMATCH");
  const block = await remote.getBlockNumber();
  const nonce = await remote.getTransactionCount({
    address: deployer,
    blockTag: "pending",
  });
  check(
    (await remote.getTransactionCount({
      address: deployer,
      blockNumber: block,
    })) === nonce,
    "PENDING_DEPLOYER_TRANSACTION",
  );
  const gasPrice = await remote.getGasPrice();
  const safeAbi = parseAbi([
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
    "function nonce() view returns (uint256)",
    "function approveHash(bytes32 hashToApprove)",
    "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)",
    "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
  ]);
  const owners = normalizeSafeOwners([
    ...(await remote.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getOwners",
      blockNumber: block,
    })),
  ]);
  check(
    owners.length === 2 &&
      (await remote.readContract({
        address: safe,
        abi: safeAbi,
        functionName: "getThreshold",
        blockNumber: block,
      })) === 2n,
    "SAFE_THRESHOLD_CHANGED",
  );
  check(
    safe === getAddress(safeEvidence.safe.address) &&
      owners.every((owner) =>
        safeEvidence.safe.owners.some(
          (a: string) => a.toLowerCase() === owner.toLowerCase(),
        ),
      ),
    "SAFE_OWNERS_CHANGED",
  );
  const timelockCode = await remote.getCode({
    address: upgrader,
    blockNumber: block,
  });
  check(
    upgrader === getAddress(governance.timelockAddress) &&
      timelockCode &&
      keccak256(timelockCode) === governance.deployedRuntimeBytecodeHash &&
      (await remote.readContract({
        address: upgrader,
        abi: parseAbi(["function getMinDelay() view returns (uint256)"]),
        functionName: "getMinDelay",
        blockNumber: block,
      })) === 300n,
    "FIVE_MINUTE_TIMELOCK_MISMATCH",
  );
  check(
    await remote.readContract({
      address: getAddress(manifest.integration.poolFactory),
      abi: parseAbi(["function hasRole(bytes32,address) view returns (bool)"]),
      functionName: "hasRole",
      args: [
        keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
        upgrader,
      ],
      blockNumber: block,
    }),
    "FACTORY_TIMELOCK_ROLE_MISSING",
  );
  const files = [
    [
      "ActionGroth16V2",
      path.join(
        directory,
        "out/ActionGroth16MainnetV2.sol/Groth16Verifier.json",
      ),
    ],
    [
      "FundGroth16V2",
      path.join(directory, "out/FundGroth16MainnetV2.sol/Groth16Verifier.json"),
    ],
    [
      "PrivateActionVerifierV2",
      path.join(
        contractRoot,
        "out/PrivateProofVerifiersV2.sol/PrivateActionVerifierV2.json",
      ),
    ],
    [
      "PrivateFundVerifierV2",
      path.join(
        contractRoot,
        "out/PrivateProofVerifiersV2.sol/PrivateFundVerifierV2.json",
      ),
    ],
    [
      "Poseidon2FieldHasherV2",
      path.join(
        contractRoot,
        "out/Poseidon2FieldHasherV2.sol/Poseidon2FieldHasherV2.json",
      ),
    ],
    [
      "PrivateVaultV2",
      path.join(contractRoot, "out/PrivateVaultV2.sol/PrivateVaultV2.json"),
    ],
    [
      "PrivateVaultV2Proxy",
      path.join(contractRoot, "out/ERC1967Proxy.sol/ERC1967Proxy.json"),
    ],
  ] as const;
  const artifacts: Record<string, Artifact> = {};
  const predicted: Record<string, Address> = {};
  for (const [index, [name, filename]] of files.entries()) {
    const artifact = (await json(filename)) as Artifact;
    const sourceRoot = index < 2 ? directory : contractRoot;
    for (const [source, meta] of Object.entries(artifact.metadata.sources)) {
      const resolved = path.resolve(sourceRoot, source);
      check(
        resolved.startsWith(`${root}/`) &&
          keccak256(await readFile(resolved)) === meta.keccak256,
        "SOURCE_PROVENANCE_MISMATCH",
      );
    }
    check(
      (artifact.deployedBytecode.object.length - 2) / 2 <= 24576,
      "EIP170_TOO_LARGE",
    );
    artifacts[name] = artifact;
    predicted[name] = getContractAddress({
      from: deployer,
      nonce: BigInt(nonce + index),
    });
    check(
      !(await remote.getCode({ address: predicted[name], blockNumber: block })),
      "PREDICTED_ADDRESS_OCCUPIED",
    );
  }
  check(
    predicted.PrivateVaultV2Proxy!.toLowerCase() !==
      manifest.shielded.vault.toLowerCase(),
    "V1_COLLISION",
  );
  const stocks = await json(
    path.join(root, "deployments/mainnet/stock-market-pools.json"),
  );
  const market = await json(path.join(root, "deployments/mainnet/market.json"));
  check(
    stocks.chainId === 4663 && market.chainId === 4663,
    "ASSET_CHAIN_MISMATCH",
  );
  const assetCandidates = [
    ...market.tokens.map((a: { address: string; symbol: string }) => ({
      address: getAddress(a.address),
      symbol: a.symbol,
    })),
    ...Object.values(
      stocks.markets as Record<string, { baseAddress: string; symbol: string }>,
    ).map((a) => ({ address: getAddress(a.baseAddress), symbol: a.symbol })),
  ];
  const assets = [];
  for (const asset of new Map(
    assetCandidates.map((a) => [a.address.toLowerCase(), a]),
  ).values()) {
    check(
      await remote.getCode({ address: asset.address, blockNumber: block }),
      "ASSET_CODE_MISSING",
    );
    const decimals = await remote.readContract({
      address: asset.address,
      abi: parseAbi(["function decimals() view returns (uint8)"]),
      functionName: "decimals",
      blockNumber: block,
    });
    assets.push({ ...asset, decimals });
  }
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const relay = await startPrivateForkRelay(process.env.RPC_URL);
  const localUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    path.join(homedir(), ".foundry/bin/anvil"),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "4663",
      "--silent",
      "--fork-url",
      relay.url,
      "--fork-block-number",
      String(block),
      "--no-fork-node-info",
      "--no-storage-caching",
      "--fork-state-by-number",
      "--retries",
      "1",
      "--timeout",
      "20000",
    ],
    { stdio: "ignore", env: { PATH: process.env.PATH } },
  );
  let spawnError = false;
  child.on("error", () => {
    spawnError = true;
  });
  const chain = defineChain({
    id: 4663,
    name: "Isolated mainnet fork",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [localUrl] } },
  });
  const local = createPublicClient({
    chain,
    transport: http(localUrl, { timeout: 60000, retryCount: 0 }),
  });
  const request = local.request as unknown as (arg: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  const abi = artifacts.PrivateVaultV2!.abi;
  const v1Abi = (
    await json(
      path.join(contractRoot, "out/ZKBlastVault.sol/ZKBlastVault.json"),
    )
  ).abi as Abi;
  const vault = predicted.PrivateVaultV2Proxy!;
  const records: {
    name: string;
    actor: Address;
    to: Address | null;
    data: Hex;
    nonce: number;
    hash: Hex;
    gasUsed: string;
    rpcEstimateGas: string | null;
    gasBudget: string;
  }[] = [];
  const overrides: StateOverride = [];
  const snapshot = async () => ({
    implementation: await local.getStorageAt({
      address: getAddress(manifest.shielded!.vault),
      slot,
    }),
    root: String(
      await local.readContract({
        address: getAddress(manifest.shielded!.vault),
        abi: v1Abi,
        functionName: "root",
      }),
    ),
    leaves: String(
      await local.readContract({
        address: getAddress(manifest.shielded!.vault),
        abi: v1Abi,
        functionName: "nextLeafIndex",
      }),
    ),
    balances: await Promise.all(
      manifest.shielded!.assets.map(async (a) => ({
        asset: a.address,
        amount: String(
          await local.readContract({
            address: getAddress(a.address),
            abi: parseAbi([
              "function balanceOf(address) view returns (uint256)",
            ]),
            functionName: "balanceOf",
            args: [getAddress(manifest.shielded!.vault)],
          }),
        ),
      })),
    ),
  });
  try {
    phase = "local-fork-start";
    let ready = false;
    for (let i = 0; i < 100; i++) {
      check(!spawnError && child.exitCode === null, "ANVIL_START_FAILED");
      try {
        ready = String(await request({ method: "web3_clientVersion" }))
          .toLowerCase()
          .includes("anvil");
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    check(ready && (await local.getChainId()) === 4663, "LOCAL_FORK_REQUIRED");
    for (const actor of [deployer, ...owners]) {
      await request({ method: "anvil_impersonateAccount", params: [actor] });
      await request({
        method: "anvil_setBalance",
        params: [actor, toHex(10n ** 20n)],
      });
    }
    const before = await snapshot();
    const send = async (
      name: string,
      actor: Address,
      data: Hex,
      to?: Address,
      rpcEstimate = false,
    ) => {
      phase = name;
      const actorNonce = await local.getTransactionCount({ address: actor });
      phase = `${name}-estimate`;
      let estimate: bigint | undefined;
      if (rpcEstimate)
        estimate = await remote.estimateGas({
          account: actor,
          data,
          nonce: actorNonce,
          blockNumber: block,
          stateOverride: [
            ...overrides,
            { address: actor, nonce: actorNonce, balance: 10n ** 20n },
          ],
        });
      const forkEstimate = await local.estimateGas({
        account: actor,
        data,
        ...(to ? { to } : {}),
      });
      const basis =
        estimate && estimate > forkEstimate ? estimate : forkEstimate;
      const gas = (basis * 125n + 99n) / 100n;
      const wallet = createWalletClient({
        account: actor,
        chain,
        transport: http(localUrl, { timeout: 60000, retryCount: 0 }),
      });
      const hash = await wallet.sendTransaction({
        data,
        ...(to ? { to } : {}),
        gas,
      });
      const receipt = await local.waitForTransactionReceipt({ hash });
      check(receipt.status === "success", "FORK_TRANSACTION_FAILED");
      records.push({
        name,
        actor,
        to: to ?? null,
        data,
        nonce: actorNonce,
        hash,
        gasUsed: String(receipt.gasUsed),
        rpcEstimateGas: estimate ? String(estimate) : null,
        gasBudget: String(
          ((estimate && estimate > receipt.gasUsed
            ? estimate
            : receipt.gasUsed) *
            125n +
            99n) /
            100n,
        ),
      });
      console.log(`${records.length}: ${name}; fork gas ${receipt.gasUsed}`);
      return receipt;
    };
    for (const [name] of files) {
      const args =
        name === "PrivateActionVerifierV2"
          ? [predicted.ActionGroth16V2]
          : name === "PrivateFundVerifierV2"
            ? [predicted.FundGroth16V2]
            : name === "PrivateVaultV2Proxy"
              ? [
                  predicted.PrivateVaultV2,
                  encodeFunctionData({
                    abi,
                    functionName: "initialize",
                    args: [
                      safe,
                      upgrader,
                      registry,
                      predicted.Poseidon2FieldHasherV2,
                      predicted.PrivateActionVerifierV2,
                      predicted.PrivateFundVerifierV2,
                      2n,
                    ],
                  }),
                ]
              : [];
      const receipt = await send(
        name,
        deployer,
        encodeDeployData({
          abi: artifacts[name]!.abi,
          bytecode: artifacts[name]!.bytecode.object,
          args,
        }),
        undefined,
        true,
      );
      check(
        receipt.contractAddress?.toLowerCase() ===
          predicted[name]!.toLowerCase(),
        "DEPLOYMENT_ADDRESS_MISMATCH",
      );
      const immutable =
        name === "PrivateVaultV2"
          ? predicted[name]
          : name === "PrivateActionVerifierV2"
            ? predicted.ActionGroth16V2
            : name === "PrivateFundVerifierV2"
              ? predicted.FundGroth16V2
              : undefined;
      const code = await local.getCode({ address: predicted[name]! });
      check(
        code?.toLowerCase() ===
          expectedRuntime(artifacts[name]!, immutable).toLowerCase(),
        "RUNTIME_MISMATCH",
      );
      overrides.push({ address: predicted[name]!, code });
    }
    const read = (functionName: string, args: readonly unknown[] = []) =>
      local.readContract({ address: vault, abi, functionName, args });
    check(
      (await read("treeVersion")) === 2n &&
        (await read("depositsPaused")) === true &&
        (await read("actionsPaused")) === true,
      "INITIALIZER_STATE_MISMATCH",
    );
    check(
      (await local.getStorageAt({ address: vault, slot })) ===
        toHex(BigInt(predicted.PrivateVaultV2!), { size: 32 }),
      "PROXY_SLOT_MISMATCH",
    );
    for (const [getter, expected] of [
      ["poolRegistry", registry],
      ["fieldHasher", predicted.Poseidon2FieldHasherV2],
      ["actionVerifier", predicted.PrivateActionVerifierV2],
      ["fundVerifier", predicted.PrivateFundVerifierV2],
    ])
      check(
        String(await read(getter!)).toLowerCase() === expected!.toLowerCase(),
        "DEPENDENCY_MISMATCH",
      );
    check(
      (await read("hasRole", [toHex(0n, { size: 32 }), safe])) &&
        (await read("hasRole", [
          keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
          upgrader,
        ])),
      "ROLE_MISMATCH",
    );
    const signatures = concatHex(
      owners.map((owner) =>
        concatHex([
          toHex(BigInt(owner), { size: 32 }),
          toHex(0n, { size: 32 }),
          "0x01",
        ]),
      ),
    );
    const safeConfiguration = async (name: string, data: Hex) => {
      const safeNonce = await local.readContract({
        address: safe,
        abi: safeAbi,
        functionName: "nonce",
      });
      const args = [
        vault,
        0n,
        data,
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
      ] as const;
      const hash = await local.readContract({
        address: safe,
        abi: safeAbi,
        functionName: "getTransactionHash",
        args: [...args, safeNonce],
      });
      await send(
        `safe-approve-${name}`,
        owners[1]!,
        encodeFunctionData({
          abi: safeAbi,
          functionName: "approveHash",
          args: [hash],
        }),
        safe,
      );
      const receipt = await send(
        `safe-exec-${name}`,
        owners[0]!,
        encodeFunctionData({
          abi: safeAbi,
          functionName: "execTransaction",
          args: [...args, signatures],
        }),
        safe,
      );
      check(
        receipt.logs.some(
          (log) =>
            log.address.toLowerCase() === safe.toLowerCase() &&
            log.topics[0] ===
              keccak256(
                new TextEncoder().encode("ExecutionSuccess(bytes32,uint256)"),
              ),
        ),
        "SAFE_INNER_EXECUTION_FAILED",
      );
      check(
        (await local.readContract({
          address: safe,
          abi: safeAbi,
          functionName: "nonce",
        })) ===
          safeNonce + 1n,
        "SAFE_NONCE_MISMATCH",
      );
    };
    for (const asset of assets) {
      await safeConfiguration(
        `enable-${asset.symbol}`,
        encodeFunctionData({
          abi,
          functionName: "setAssetEnabled",
          args: [asset.address, true],
        }),
      );
      check(
        (await read("assetEnabled", [asset.address])) === true,
        "ASSET_CONFIG_FAILED",
      );
    }
    await safeConfiguration(
      "unpause-v2",
      encodeFunctionData({
        abi,
        functionName: "setPaused",
        args: [false, false, false],
      }),
    );
    check(
      (await read("depositsPaused")) === false &&
        (await read("actionsPaused")) === false &&
        (await read("withdrawalsPaused")) === false,
      "PAUSE_CONFIG_FAILED",
    );
    const after = await snapshot();
    check(
      JSON.stringify(before) === JSON.stringify(after),
      "V1_FORK_STATE_CHANGED",
    );
    check(
      (await readFile(manifestFile)).equals(activeBytes) &&
        (await remote.getTransactionCount({
          address: deployer,
          blockTag: "pending",
        })) === nonce,
      "ACTIVE_STATE_OR_NONCE_CHANGED",
    );
    const gasBudget = records.reduce(
      (n, record) => n + BigInt(record.gasBudget),
      0n,
    );
    const actorBudgets = await Promise.all(
      [...new Set(records.map((r) => r.actor))].map(async (actor) => ({
        actor,
        balanceEth: formatEther(
          await remote.getBalance({ address: actor, blockNumber: block }),
        ),
        recommendedFeeCapEth: formatEther(
          records
            .filter((r) => r.actor === actor)
            .reduce((n, r) => n + BigInt(r.gasBudget), 0n) *
            gasPrice *
            2n,
        ),
      })),
    );
    const report = {
      environment: "mainnet",
      chainId: 4663,
      generatedAt: new Date().toISOString(),
      sourceBlock: String(block),
      sourceCandidate: candidateName,
      candidateSha256: sha(
        await readFile(path.join(directory, "candidate.json")),
      ),
      deploymentVerifiedOnForkOnly: true,
      broadcastAllowed: false,
      activationAllowed: false,
      liveTransactionsBroadcast: 0,
      signingKeysUsed: false,
      observedPendingNonce: nonce,
      predicted,
      governance: {
        safe,
        owners,
        threshold: 2,
        timelock: upgrader,
        delaySeconds: 300,
        configurationRoute:
          "owner1 approveHash + owner0 execTransaction; approved-hash signatures on fork only, no live authorization",
      },
      assets,
      v1ForkStateUnchanged: true,
      legacyBefore: before,
      legacyAfter: after,
      actualForkGasUsed: String(
        records.reduce((n, r) => n + BigInt(r.gasUsed), 0n),
      ),
      conservativeGasBasis: String(
        records.reduce((n, r) => n + (BigInt(r.gasBudget) * 100n) / 125n, 0n),
      ),
      gasBudget: String(gasBudget),
      gasPriceWei: String(gasPrice),
      recommendedFeeCapEth: formatEther(gasBudget * gasPrice * 2n),
      actorBudgets,
      rpcEstimateCoverage: `${records.filter((r) => r.rpcEstimateGas).length}/${records.length}`,
      receipts: records.map(({ data: _data, ...record }) => record),
      caveats: [
        "All hashes are LOCAL Anvil transactions, not explorer transactions",
        "Only deployment estimates have live RPC state-override coverage; Safe approval/execution gas uses fork estimates and may omit chain-specific data fees",
        "Fresh single-operator candidate is not independently reviewed or approved for release",
        "No live lifecycle/browser or refund acceptance completed",
        "Active runtime schema remains testnet-only for v2: mainnet API/UI activation is a separate gated implementation step",
        "No manifest, database, Railway, old vault or testnet state changed",
      ],
    };
    await save("mainnet-rehearsal.json", report);
    await save("mainnet-proposal.json", {
      ...report,
      transactions: records.map(
        ({
          hash: _hash,
          gasUsed: _gas,
          rpcEstimateGas: _estimate,
          ...record
        }) => ({ ...record, calldataHash: keccak256(record.data) }),
      ),
      scope:
        "Unapproved candidate only: 7 new v2 deployments and Safe asset/pause configuration; no v1 upgrade, deposit, funding or live broadcast",
    });
    console.log(
      JSON.stringify({
        result: "MAINNET_FORK_PASSED",
        deployments: 7,
        safeConfigurations: assets.length + 1,
        localTransactions: records.length,
        recommendedFeeCapEth: report.recommendedFeeCapEth,
        rpcEstimateCoverage: report.rpcEstimateCoverage,
        liveTransactionsBroadcast: 0,
      }),
    );
  } finally {
    child.kill("SIGTERM");
    await relay.close();
  }
}
main().catch((error) => {
  const summary = String(
    (error as { shortMessage?: string })?.shortMessage ?? "",
  )
    .split("\n")[0]
    ?.replace(/`/gu, "");
  console.error(
    `Fork error type: ${error instanceof Error ? error.name : "UNKNOWN"}; Safe code: ${String(error?.message ?? "").match(/\bGS\d{3}\b/u)?.[0] ?? "none"}`,
  );
  if (summary && /^[a-zA-Z0-9 ._,:()'\-]{1,240}$/u.test(summary))
    console.error(`Fork diagnostic: ${summary}`);
  console.error(
    `MAINNET_V2_SIMULATION_STOPPED (${phase}): ${error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "READ_ONLY_OR_FORK_FAILURE"}; no live broadcast`,
  );
  process.exitCode = 1;
});
