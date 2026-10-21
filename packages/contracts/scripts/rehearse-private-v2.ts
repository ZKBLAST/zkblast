import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  getAddress,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toHex,
  formatEther,
  type Abi,
  type Address,
  type Hex,
  type StateOverride,
} from "viem";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { startPrivateForkRelay } from "./private-v2-fork-relay.js";

// Only the localhost Anvil transport receives transactions. No signing key is read.
const root = path.resolve(import.meta.dirname, "../../..");
const contractRoot = path.join(root, "packages/contracts");
const stageName = process.argv[2];
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
check(
  /^browser-stage-[A-Za-z0-9_-]+$/u.test(stageName ?? ""),
  "EXPLICIT_V2_STAGE_REQUIRED",
);
const stage = path.join(
  root,
  "packages/circuits/target/v2-testnet",
  stageName!,
);
const slot: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
let phase = "runtime";
type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  metadata: {
    compiler: { version: string };
    sources: Record<string, { keccak256: Hex }>;
  };
  storageLayout?: { storage: { label: string; slot: string; type: string }[] };
};
type Stage = {
  deployer: Address;
  observedPendingNonce: number;
  predicted: Record<string, Address>;
  admin: Address;
  upgrader: Address;
  registry: Address;
  reference: { manifestSha256: string };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  check(address && typeof address !== "string", "LOCAL_PORT_UNAVAILABLE");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function expectedRuntime(artifact: Artifact, immutable?: Address): Hex {
  let code = artifact.deployedBytecode.object.slice(2);
  for (const references of Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  )) {
    check(immutable, "UNEXPECTED_IMMUTABLE");
    for (const ref of references) {
      const value = BigInt(immutable)
        .toString(16)
        .padStart(ref.length * 2, "0");
      check(value.length === ref.length * 2, "IMMUTABLE_LENGTH_MISMATCH");
      code =
        code.slice(0, ref.start * 2) +
        value +
        code.slice((ref.start + ref.length) * 2);
    }
  }
  return `0x${code}`;
}

async function main() {
  check(
    process.env.APP_ENV === "testnet" &&
      process.env.CHAIN_ID === "46630" &&
      process.env.RPC_URL,
    "TESTNET_RUNTIME_REQUIRED",
  );
  const staged = JSON.parse(
    await readFile(path.join(stage, "staging.json"), "utf8"),
  ) as Stage;
  const verified = JSON.parse(
    await readFile(path.join(stage, "artifact-verification.json"), "utf8"),
  ) as { results: { zkeyVerifiedAgainstR1cs: boolean }[] };
  check(
    verified.results.length === 2 &&
      verified.results.every((result) => result.zkeyVerifiedAgainstR1cs),
    "ARTIFACT_VERIFICATION_REQUIRED",
  );
  const manifest = await loadDeploymentManifestFile(
    path.join(root, "deployments/testnet/manifest.json"),
    { environment: "testnet", chainId: 46630 },
  );
  check(manifest.shielded, "V1_BASELINE_REQUIRED");
  const sources = new Set<string>();
  const artifacts: Record<string, Artifact> = {};
  const files = [
    ["ActionGroth16V2", "ActionGroth16.local.sol/Groth16Verifier.json"],
    ["FundGroth16V2", "FundGroth16.local.sol/Groth16Verifier.json"],
    [
      "PrivateActionVerifierV2",
      "PrivateProofVerifiersV2.sol/PrivateActionVerifierV2.json",
    ],
    [
      "PrivateFundVerifierV2",
      "PrivateProofVerifiersV2.sol/PrivateFundVerifierV2.json",
    ],
    [
      "Poseidon2FieldHasherV2",
      "Poseidon2FieldHasherV2.sol/Poseidon2FieldHasherV2.json",
    ],
    ["PrivateVaultV2", "PrivateVaultV2.sol/PrivateVaultV2.json"],
    ["PrivateVaultV2Proxy", "ERC1967Proxy.sol/ERC1967Proxy.json"],
  ] as const;
  phase = "compiler-source-provenance";
  for (const [name, filename] of files) {
    const artifact = JSON.parse(
      await readFile(path.join(contractRoot, "out", filename), "utf8"),
    ) as Artifact;
    check(
      artifact.metadata.compiler.version === "0.8.26+commit.8a97fa7a",
      "SOLC_VERSION_MISMATCH",
    );
    check(
      (artifact.deployedBytecode.object.length - 2) / 2 <= 24576,
      "EIP170_RUNTIME_TOO_LARGE",
    );
    for (const [source, metadata] of Object.entries(
      artifact.metadata.sources,
    )) {
      const filename = path.resolve(contractRoot, source);
      check(
        filename.startsWith(`${root}${path.sep}`),
        "SOURCE_OUTSIDE_PROJECT",
      );
      check(
        keccak256(await readFile(filename)) === metadata.keccak256,
        "COMPILED_SOURCE_CHANGED_REBUILD_REQUIRED",
      );
      sources.add(source);
    }
    artifacts[name] = artifact;
  }
  const remote = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }),
  });
  const privateVaultV2Abi = artifacts.PrivateVaultV2!.abi;
  const zkBlastVaultAbi = (
    JSON.parse(
      await readFile(
        path.join(contractRoot, "out/ZKBlastVault.sol/ZKBlastVault.json"),
        "utf8",
      ),
    ) as Artifact
  ).abi;
  const erc20Abi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);
  phase = "read-only-testnet-snapshot";
  check(
    (await remote.getChainId()) === manifest.chainId,
    "REMOTE_CHAIN_MISMATCH",
  );
  const block = await remote.getBlockNumber();
  const [pendingNonce, confirmedNonce, gasPrice, balance] = await Promise.all([
    remote.getTransactionCount({
      address: staged.deployer,
      blockTag: "pending",
    }),
    remote.getTransactionCount({
      address: staged.deployer,
      blockNumber: block,
    }),
    remote.getGasPrice(),
    remote.getBalance({ address: staged.deployer, blockNumber: block }),
  ]);
  check(
    pendingNonce === staged.observedPendingNonce &&
      confirmedNonce === pendingNonce,
    "DEPLOYER_NONCE_CHANGED_RESTAGE_REQUIRED",
  );
  const timelockAbi = parseAbi([
    "function getMinDelay() view returns (uint256)",
  ]);
  const delay = await remote.readContract({
    address: staged.upgrader,
    abi: timelockAbi,
    functionName: "getMinDelay",
    blockNumber: block,
  });
  check(delay === 300n, "UPGRADER_TIMELOCK_NOT_FIVE_MINUTES");
  const mappings = JSON.parse(
    await readFile(
      path.join(root, "data/testnet-market-mappings.json"),
      "utf8",
    ),
  ) as {
    chainId: number;
    mappings: { address: Address; symbol: string; decimals: number }[];
  };
  check(mappings.chainId === manifest.chainId, "ASSET_MAPPING_CHAIN_MISMATCH");
  const usdg = manifest.shielded.assets.find(
    (asset) => asset.symbol === "USDG",
  );
  check(usdg, "TESTNET_USDG_REQUIRED");
  const assets = [
    ...new Map(
      [
        {
          address: getAddress(usdg.address),
          symbol: usdg.symbol,
          decimals: usdg.decimals,
        },
        ...mappings.mappings,
      ].map((asset) => [
        asset.address.toLowerCase(),
        { ...asset, address: getAddress(asset.address) },
      ]),
    ).values(),
  ];
  const port = await freePort();
  const relay = await startPrivateForkRelay(process.env.RPC_URL);
  const localUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    process.env.ANVIL_BIN ?? path.join(homedir(), ".foundry/bin/anvil"),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      String(manifest.chainId),
      "--silent",
      "--fork-url", relay.url,
      "--fork-block-number", String(block),
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
  let spawnFailed = false;
  anvil.on("error", () => {
    spawnFailed = true;
  });
  const chain = defineChain({
    id: manifest.chainId,
    name: "ZKBLAST isolated testnet fork",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [localUrl] } },
  });
  const local = createPublicClient({
    chain,
    cacheTime: 0,
    transport: http(localUrl, { timeout: 60_000, retryCount: 0 }),
  });
  const request = local.request as unknown as (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  const receipts: {
    name: string;
    actor: Address;
    hash: Hex;
    gasUsed: string;
    rpcEstimateGas: string | null;
    estimateSource: string;
  }[] = [];
  const proposals: {
    name: string;
    actor: Address;
    nonce: number;
    to: Address | null;
    data: Hex;
    calldataHash: Hex;
    gasBudget: string;
  }[] = [];
  const codeOverrides: StateOverride = [];
  try {
    phase = "localhost-anvil-startup";
    let started = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      check(!spawnFailed && anvil.exitCode === null, "ANVIL_START_FAILED");
      try {
        started = String(await request({ method: "web3_clientVersion" }))
          .toLowerCase()
          .includes("anvil");
      } catch {
        /* Await this isolated child only. */
      }
      if (started) break;
      await sleep(100);
    }
    check(
      started && new URL(localUrl).hostname === "127.0.0.1",
      "LOCAL_ANVIL_REQUIRED",
    );
    phase = "fork-chain-verification";
    check(
      (await local.getChainId()) === manifest.chainId,
      "FORK_CHAIN_MISMATCH",
    );
    phase = "fork-impersonation";
    for (const actor of new Set([staged.deployer, staged.admin])) {
      await request({ method: "anvil_impersonateAccount", params: [actor] });
      await request({
        method: "anvil_setBalance",
        params: [actor, toHex(10n ** 20n)],
      });
    }
    const legacySnapshot = async () => {
      const vault = getAddress(manifest.shielded!.vault);
      phase = "legacy-v1-root-and-leaf-read";
      const root = await local.readContract({ address: vault, abi: zkBlastVaultAbi, functionName: "root" });
      const leaves = String(await local.readContract({ address: vault, abi: zkBlastVaultAbi, functionName: "nextLeafIndex" }));
      return {
        vault,
        implementationSlot: await local.getStorageAt({ address: vault, slot }),
        root, leaves,
        balances: await Promise.all(
          manifest.shielded!.assets.map(async (asset) => {
            const address = getAddress(asset.address);
            let liabilityRaw: string | null = null;
            // Older v1 implementations need not expose this newer optional getter.
            try { liabilityRaw = String(await local.readContract({ address: vault, abi: zkBlastVaultAbi,
              functionName: "liabilityRaw", args: [address] })); } catch { /* Report unavailable, never assume zero. */ }
            phase = "legacy-v1-enabled-asset-balances";
            return { address,
            raw: String(
              await local.readContract({
                address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [vault],
              }),
            ),
            liabilityRaw };
          }),
        ),
      };
    };
    phase = "legacy-v1-baseline-read";
    const legacyBefore = await legacySnapshot();
    const send = async (
      name: string,
      actor: Address,
      data: Hex,
      to?: Address,
      extraOverrides: StateOverride = [],
    ) => {
      phase = `fork-${name}`;
      const actorNonce = await local.getTransactionCount({ address: actor });
      let rpcEstimate: bigint | undefined;
      try {
        rpcEstimate = await remote.estimateGas({
          account: actor,
          data,
          ...(to ? { to } : {}),
          stateOverride: [
            ...codeOverrides,
            ...extraOverrides,
            {
              address: actor,
              nonce: actorNonce,
              balance: 10n ** 20n,
            },
          ],
        });
      } catch {
        /* Fork estimate is explicitly labelled below; never print RPC errors containing URLs. */
      }
      const wallet = createWalletClient({
        account: actor,
        chain,
        transport: http(localUrl, { timeout: 60_000 }),
      });
      const hash = await wallet.sendTransaction({
        data,
        ...(to ? { to } : {}),
        gas: 25_000_000n,
      });
      const receipt = await local.waitForTransactionReceipt({ hash });
      check(receipt.status === "success", "FORK_TRANSACTION_REVERTED");
      receipts.push({
        name,
        actor,
        hash,
        gasUsed: String(receipt.gasUsed),
        rpcEstimateGas: rpcEstimate ? String(rpcEstimate) : null,
        estimateSource: rpcEstimate
          ? "live-testnet-rpc-state-override"
          : "local-fork-execution-only",
      });
      const gasBasis =
        rpcEstimate && rpcEstimate > receipt.gasUsed
          ? rpcEstimate
          : receipt.gasUsed;
      proposals.push({
        name,
        actor,
        nonce: actorNonce,
        to: to ?? null,
        data,
        calldataHash: keccak256(data),
        gasBudget: String((gasBasis * 125n + 99n) / 100n),
      });
      console.log(
        `${name}: fork gas ${receipt.gasUsed}; RPC estimate ${rpcEstimate ?? "unavailable"}`,
      );
      return receipt;
    };
    for (const [name] of files) {
      const artifact = artifacts[name]!;
      let args: readonly unknown[] = [];
      if (name === "PrivateActionVerifierV2")
        args = [staged.predicted.ActionGroth16V2];
      if (name === "PrivateFundVerifierV2")
        args = [staged.predicted.FundGroth16V2];
      if (name === "PrivateVaultV2Proxy")
        args = [
          staged.predicted.PrivateVaultV2,
          encodeFunctionData({
            abi: privateVaultV2Abi,
            functionName: "initialize",
            args: [
              staged.admin,
              staged.upgrader,
              staged.registry,
              staged.predicted.Poseidon2FieldHasherV2!,
              staged.predicted.PrivateActionVerifierV2!,
              staged.predicted.PrivateFundVerifierV2!,
              2n,
            ],
          }),
        ];
      const { encodeDeployData } = await import("viem");
      const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        args,
      });
      const receipt = await send(name, staged.deployer, data);
      check(
        receipt.contractAddress?.toLowerCase() ===
          staged.predicted[name]!.toLowerCase(),
        "FORK_DEPLOYMENT_ADDRESS_MISMATCH",
      );
      const address = staged.predicted[name]!;
      const code = await local.getCode({ address });
      const immutable =
        name === "PrivateVaultV2"
          ? address
          : name === "PrivateActionVerifierV2"
            ? staged.predicted.ActionGroth16V2
            : name === "PrivateFundVerifierV2"
              ? staged.predicted.FundGroth16V2
              : undefined;
      check(
        code?.toLowerCase() ===
          expectedRuntime(artifact, immutable).toLowerCase(),
        "DEPLOYED_RUNTIME_MISMATCH",
      );
      codeOverrides.push({ address, code });
    }
    const vault = staged.predicted.PrivateVaultV2Proxy!;
    const read = (
      functionName:
        | "treeVersion"
        | "poolRegistry"
        | "fieldHasher"
        | "actionVerifier"
        | "fundVerifier"
        | "depositsPaused"
        | "actionsPaused"
        | "withdrawalsPaused",
    ) =>
      local.readContract({
        address: vault,
        abi: privateVaultV2Abi,
        functionName,
      });
    check(
      (await read("treeVersion")) === 2n &&
        (await read("depositsPaused")) === true &&
        (await read("actionsPaused")) === true &&
        (await read("withdrawalsPaused")) === false,
      "INITIALIZER_STATE_MISMATCH",
    );
    for (const [getter, expected] of [
      ["poolRegistry", staged.registry],
      ["fieldHasher", staged.predicted.Poseidon2FieldHasherV2],
      ["actionVerifier", staged.predicted.PrivateActionVerifierV2],
      ["fundVerifier", staged.predicted.PrivateFundVerifierV2],
    ] as const)
      check(
        String(await read(getter)).toLowerCase() === expected!.toLowerCase(),
        "INITIALIZER_DEPENDENCY_MISMATCH",
      );
    check(
      (await local.getStorageAt({ address: vault, slot })) ===
        toHex(BigInt(staged.predicted.PrivateVaultV2!), { size: 32 }),
      "IMPLEMENTATION_SLOT_MISMATCH",
    );
    for (const [role, actor] of [
      [`0x${"0".repeat(64)}`, staged.admin],
      [
        keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
        staged.upgrader,
      ],
    ] as const)
      check(
        await local.readContract({
          address: vault,
          abi: privateVaultV2Abi,
          functionName: "hasRole",
          args: [role as Hex, actor],
        }),
        "INITIALIZER_ROLE_MISMATCH",
      );
    const layout = artifacts.PrivateVaultV2!.storageLayout!.storage;
    const rolesSlot = layout.find((field) => field.label === "_roles")?.slot;
    check(rolesSlot, "ROLES_LAYOUT_MISSING");
    const outer = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [`0x${"0".repeat(64)}`, BigInt(rolesSlot)],
      ),
    );
    const adminSlot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [staged.admin, outer],
      ),
    );
    const scalarSlots = [
      ...new Set(
        layout
          .filter(
            (field) =>
              !field.type.startsWith("t_mapping") &&
              !field.type.startsWith("t_struct") &&
              !field.type.startsWith("t_array"),
          )
          .map((field) => field.slot),
      ),
    ];
    const stateDiff = await Promise.all(
      [
        slot,
        adminSlot,
        ...scalarSlots.map((value) => toHex(BigInt(value), { size: 32 })),
      ].map(async (key) => ({
        slot: key,
        value:
          (await local.getStorageAt({ address: vault, slot: key })) ??
          toHex(0n, { size: 32 }),
      })),
    );
    // Replace, rather than duplicate, the proxy override when adding storage.
    const proxyOverride = codeOverrides.find(
      (entry) => entry.address === vault,
    )!;
    proxyOverride.stateDiff = stateDiff;
    for (const asset of assets) {
      check(
        (await local.readContract({
          address: asset.address,
          abi: erc20Abi,
          functionName: "decimals",
        })) === asset.decimals,
        "ASSET_DECIMALS_MISMATCH",
      );
      await send(
        `enable-${asset.symbol}`,
        staged.admin,
        encodeFunctionData({
          abi: privateVaultV2Abi,
          functionName: "setAssetEnabled",
          args: [asset.address, true],
        }),
        vault,
      );
      check(
        await local.readContract({
          address: vault,
          abi: privateVaultV2Abi,
          functionName: "assetEnabled",
          args: [asset.address],
        }),
        "ASSET_CONFIGURATION_FAILED",
      );
    }
    await send(
      "enable-v2-operations",
      staged.admin,
      encodeFunctionData({
        abi: privateVaultV2Abi,
        functionName: "setPaused",
        args: [false, false, false],
      }),
      vault,
    );
    check(
      (await read("depositsPaused")) === false &&
        (await read("actionsPaused")) === false,
      "ACTIVATION_SIMULATION_FAILED",
    );
    const legacyAfter = await legacySnapshot();
    check(
      JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter),
      "V1_FORK_STATE_CHANGED",
    );
    check(
      (await remote.getTransactionCount({
        address: staged.deployer,
        blockTag: "pending",
      })) === pendingNonce,
      "DEPLOYER_NONCE_CHANGED_DURING_REHEARSAL",
    );
    const forkGas = receipts.reduce(
      (sum, receipt) => sum + BigInt(receipt.gasUsed),
      0n,
    );
    const estimatedGas = receipts.reduce(
      (sum, receipt) =>
        sum +
        (receipt.rpcEstimateGas
          ? BigInt(receipt.rpcEstimateGas) > BigInt(receipt.gasUsed)
            ? BigInt(receipt.rpcEstimateGas)
            : BigInt(receipt.gasUsed)
          : BigInt(receipt.gasUsed)),
      0n,
    );
    const gasBudget = proposals.reduce(
      (sum, proposal) => sum + BigInt(proposal.gasBudget),
      0n,
    );
    const feeBudget = gasBudget * gasPrice * 2n;
    const actorBudgets = await Promise.all(
      [...new Set(proposals.map((proposal) => proposal.actor))].map(
        async (actor) => {
          const gas = proposals
            .filter((proposal) => proposal.actor === actor)
            .reduce((sum, proposal) => sum + BigInt(proposal.gasBudget), 0n);
          const actorBalance = await remote.getBalance({
            address: actor,
            blockNumber: block,
          });
          return {
            address: actor,
            gasBudget: String(gas),
            recommendedFeeCapEth: formatEther(gas * gasPrice * 2n),
            balanceEth: formatEther(actorBalance),
            sufficientAtQuotedCap: actorBalance >= gas * gasPrice * 2n,
          };
        },
      ),
    );
    const report = {
      environment: "testnet",
      chainId: manifest.chainId,
      sourceBlock: String(block),
      generatedAt: new Date().toISOString(),
      deploymentVerifiedOnForkOnly: true,
      activationAllowed: false,
      liveTransactionsBroadcast: 0,
      signingKeysUsed: false,
      sourceFilesVerified: sources.size,
      contractsVerified: files.length,
      fiveMinuteUpgraderVerified: true,
      observedPendingNonce: pendingNonce,
      predicted: staged.predicted,
      assets,
      v1ForkStateUnchanged: true,
      legacyBefore,
      legacyAfter,
      receipts,
      forkGasUsed: String(forkGas),
      estimatedGas: String(estimatedGas),
      gasPriceWei: String(gasPrice),
      estimatedFeeEth: formatEther(estimatedGas * gasPrice),
      recommendedGasBudget: String(gasBudget),
      recommendedFeeCapEth: formatEther(feeBudget),
      deployerBalanceEth: formatEther(balance),
      actorBudgets,
      rpcEstimateCoverage: `${receipts.filter((receipt) => receipt.rpcEstimateGas).length}/${receipts.length}`,
      caveats: [
        "Fork transaction hashes are local only, not explorer transactions",
        "Not a deposit/swap/LP lifecycle or actual-browser acceptance",
        "Fees and nonce must be rechecked before broadcast",
        "Source eligibility/trust gates are not overridden by this rehearsal",
        "Non-RPC-covered estimates exclude possible chain-specific overhead",
      ],
    };
    await writeFile(
      path.join(stage, "deployment-rehearsal.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeFile(
      path.join(stage, "broadcast-proposal.json"),
      `${JSON.stringify(
        {
          environment: "testnet",
          chainId: manifest.chainId,
          sourceBlock: String(block),
          expectedDeployerNonce: pendingNonce,
          activationAllowed: false,
          broadcastApproved: false,
          maxFeePerGasWei: String(gasPrice * 2n),
          totalFeeCapWei: String(feeBudget),
          actorBudgets,
          transactions: proposals,
          scope:
            "Seven new v2 deployments and listed v2-only asset/pause configuration. No v1 upgrade, deposit, swap, token funding, or Railway deployment.",
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      JSON.stringify({
        result: "fork-deployment-passed",
        contracts: files.length,
        configurationTransactions: receipts.length - files.length,
        estimatedGas: report.estimatedGas,
        gasPriceWei: report.gasPriceWei,
        estimatedFeeEth: report.estimatedFeeEth,
        recommendedFeeCapEth: report.recommendedFeeCapEth,
        rpcEstimateCoverage: report.rpcEstimateCoverage,
        liveTransactionsBroadcast: 0,
      }),
    );
  } finally {
    anvil.kill("SIGTERM");
    await relay.close();
  }
}
void main().catch((error: unknown) => {
  const category =
    error instanceof Error
      ? /timeout|timed out/iu.test(error.message)
        ? "RPC_TIMEOUT"
        : /revert/iu.test(error.message)
          ? "RPC_REVERT"
          : "UNAVAILABLE"
      : "UNAVAILABLE";
  console.error(
    `V2_REHEARSAL_FAILED (${phase}): ${error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : category}; no live transaction was submitted.`,
  );
  process.exitCode = 1;
});
