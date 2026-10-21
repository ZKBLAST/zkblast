import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  createPublicClient,
  http,
  parseAbi,
  encodeDeployData,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  toHex,
  concatHex,
  zeroAddress,
  formatEther,
  type Hex,
  type Address,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeSafeOwners } from "./private-v2-safe-owners.js";

// A frozen, operator-approved plan. This does not activate a web release.
const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(
  root,
  "packages/circuits/target/v2-mainnet/candidate-s5KJOD",
);
const simulation = process.argv[2] === "--simulate-local";
const prefix = simulation ? `executor-fork-${Date.now()}` : "mainnet";
const journalFile = path.join(directory, `${prefix}-execution.json`);
const lockFile = path.join(directory, `${prefix}-execution.lock`);
const cap = 700_000_000_000_000n;
const maxGasPrice = 40_012_000n;
const approvedHash =
  "b874aaa9ef5a6e5d304d0dda0a8b64d9e4114eb6c87e42f3eef55b42e4585661";
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function approvedHashes(address,bytes32) view returns (uint256)",
  "function approveHash(bytes32)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
]);
type Planned = {
  name: string;
  actor: Address;
  nonce: number;
  gasBudget: string;
  data: Hex;
  calldataHash: Hex;
  to: Address | null;
};
type Entry = {
  name: string;
  hash: Hex;
  state: "signed" | "confirmed";
  status?: string;
  feeWei?: string;
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  blockNumber?: string;
  blockHash?: Hex;
  contractAddress?: Address | null;
};
type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  metadata: { sources: Record<string, { keccak256: Hex }> };
};
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
let locked = false;
let phase = "load";
async function save(value: unknown) {
  await writeFile(`${journalFile}.tmp`, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(`${journalFile}.tmp`, journalFile);
}
function runtime(artifact: Artifact, immutable?: Address): Hex {
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
    (process.argv[2] === "--approved-0.0007-eth" || simulation) &&
      process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL,
    "EXPLICIT_MAINNET_APPROVAL_REQUIRED",
  );
  const lock = await open(lockFile, "wx", 0o600);
  locked = true;
  await lock.close();
  const proposalBytes = await readFile(
    path.join(directory, "mainnet-proposal.json"),
  );
  check(sha(proposalBytes) === approvedHash, "APPROVED_PROPOSAL_CHANGED");
  const proposal = JSON.parse(proposalBytes.toString());
  const planned = proposal.transactions as Planned[];
  check(
    planned.length === 27 &&
      proposal.chainId === 4663 &&
      proposal.v1ForkStateUnchanged &&
      proposal.deploymentVerifiedOnForkOnly,
    "PLAN_SCOPE_CHANGED",
  );
  check(
    sha(await readFile(path.join(directory, "candidate.json"))) ===
      proposal.candidateSha256,
    "CANDIDATE_CHANGED",
  );
  const manifests = await Promise.all(
    ["mainnet", "testnet"].map(async (environment) => ({
      file: path.join(root, `deployments/${environment}/manifest.json`),
      bytes: await readFile(
        path.join(root, `deployments/${environment}/manifest.json`),
      ),
    })),
  );
  check(
    sha(manifests[0]!.bytes) ===
      "a0b138e75f683a2c196560d1184d75bbb0748b6755cf40b3b3117f1de758f8c8" &&
      sha(manifests[1]!.bytes) ===
        "beb9e8f840fde5310297a0187ea6fea9554b6f9557fc9d8416d74428990eb339",
    "ACTIVE_MANIFEST_CHANGED",
  );
  const manifest = JSON.parse(manifests[0]!.bytes.toString());
  const predicted = proposal.predicted as Record<string, Address>;
  const vault = predicted.PrivateVaultV2Proxy!;
  const safe = proposal.governance.safe as Address;
  const owners = normalizeSafeOwners(proposal.governance.owners);
  const accounts = [
    "DEPLOYER_PRIVATE_KEY",
    "GOVERNANCE_PRIVATE_KEY",
    "UPGRADER_PRIVATE_KEY",
  ].map((name) => {
    const key = process.env[name]?.trim();
    check(/^0x[0-9a-fA-F]{64}$/u.test(key ?? ""), "KEY_REQUIRED");
    return privateKeyToAccount(key as Hex);
  });
  check(
    accounts[0]!.address === planned[0]!.actor &&
      accounts[1]!.address === owners[0] &&
      accounts[2]!.address === owners[1],
    "SIGNER_MISMATCH",
  );
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20000, retryCount: 0 }),
  });
  check((await client.getChainId()) === 4663, "CHAIN_MISMATCH");
  if (simulation) {
    check(
      /^http:\/\/127\.0\.0\.1:\d+$/u.test(process.env.RPC_URL!),
      "SIMULATION_LOOPBACK_ONLY",
    );
    const version = await client.request({ method: "web3_clientVersion" });
    check(version.toLowerCase().includes("anvil"), "SIMULATION_ANVIL_ONLY");
  }
  check(
    proposal.assets.length === 9 && planned.slice(7).length === 20,
    "MAINNET_NINE_ASSETS_REQUIRED",
  );
  check(
    (await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getThreshold",
    })) === 2n &&
      JSON.stringify(
        normalizeSafeOwners(
          await client.readContract({
            address: safe,
            abi: safeAbi,
            functionName: "getOwners",
          }),
        ),
      ) === JSON.stringify(owners),
    "SAFE_OWNERS_CHANGED",
  );
  const governance = await json(
    path.join(root, "deployments/mainnet/governance.json"),
  );
  const safeEvidence = await json(
    path.join(root, "deployments/mainnet/safe.json"),
  );
  check(
    keccak256((await client.getCode({ address: safe }))!) ===
      safeEvidence.safe.runtimeBytecodeHash &&
      keccak256(
        (await client.getCode({ address: proposal.governance.timelock }))!,
      ) === governance.deployedRuntimeBytecodeHash,
    "GOVERNANCE_CODE_CHANGED",
  );
  check(
    (await client.readContract({
      address: proposal.governance.timelock,
      abi: parseAbi(["function getMinDelay() view returns (uint256)"]),
      functionName: "getMinDelay",
    })) === 300n,
    "TIMELOCK_CHANGED",
  );
  const files = [
    "ActionGroth16MainnetV2.sol/Groth16Verifier.json",
    "FundGroth16MainnetV2.sol/Groth16Verifier.json",
    "PrivateProofVerifiersV2.sol/PrivateActionVerifierV2.json",
    "PrivateProofVerifiersV2.sol/PrivateFundVerifierV2.json",
    "Poseidon2FieldHasherV2.sol/Poseidon2FieldHasherV2.json",
    "PrivateVaultV2.sol/PrivateVaultV2.json",
    "ERC1967Proxy.sol/ERC1967Proxy.json",
  ];
  const artifacts: Artifact[] = [];
  for (let i = 0; i < files.length; i++) {
    const sourceRoot =
      i < 2 ? directory : path.join(root, "packages/contracts");
    const artifact: Artifact = await json(
      path.join(sourceRoot, "out", files[i]!),
    );
    for (const [source, meta] of Object.entries(artifact.metadata.sources))
      check(
        keccak256(await readFile(path.resolve(sourceRoot, source))) ===
          meta.keccak256,
        "SOURCE_CHANGED",
      );
    artifacts.push(artifact);
  }
  const abi = artifacts[5]!.abi;
  const read = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: vault, abi, functionName, args });
  const init = encodeFunctionData({
    abi,
    functionName: "initialize",
    args: [
      safe,
      proposal.governance.timelock,
      manifest.contracts.PoolRegistry.proxyAddress,
      predicted.Poseidon2FieldHasherV2,
      predicted.PrivateActionVerifierV2,
      predicted.PrivateFundVerifierV2,
      2n,
    ],
  });
  for (let i = 0; i < 7; i++) {
    const tx = planned[i]!;
    const args =
      i === 2
        ? [predicted.ActionGroth16V2]
        : i === 3
          ? [predicted.FundGroth16V2]
          : i === 6
            ? [predicted.PrivateVaultV2, init]
            : [];
    check(
      tx.to === null &&
        tx.actor === accounts[0]!.address &&
        tx.nonce === 401 + i &&
        tx.data ===
          encodeDeployData({
            abi: artifacts[i]!.abi,
            bytecode: artifacts[i]!.bytecode.object,
            args,
          }),
      "DEPLOYMENT_CALLDATA_CHANGED",
    );
  }
  const signatures = concatHex(
    owners.map((owner) =>
      concatHex([
        toHex(BigInt(owner), { size: 32 }),
        toHex(0n, { size: 32 }),
        "0x01",
      ]),
    ),
  );
  type SafeArgs = readonly [
    Address,
    bigint,
    Hex,
    number,
    bigint,
    bigint,
    bigint,
    Address,
    Address,
    Hex,
  ];
  const operations: { hash: Hex; args: SafeArgs }[] = [];
  for (let i = 0; i < 10; i++) {
    const inner =
      i === 9
        ? encodeFunctionData({
            abi,
            functionName: "setPaused",
            args: [false, false, false],
          })
        : encodeFunctionData({
            abi,
            functionName: "setAssetEnabled",
            args: [proposal.assets[i].address, true],
          });
    const hashArgs = [
      vault,
      0n,
      inner,
      0,
      0n,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      BigInt(20 + i),
    ] as const;
    const hash = await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getTransactionHash",
      args: hashArgs,
    });
    const args: SafeArgs = [
      vault,
      0n,
      inner,
      0,
      0n,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      signatures,
    ];
    const approve = planned[7 + i * 2]!;
    const exec = planned[8 + i * 2]!;
    check(
      approve.actor === owners[1] &&
        approve.nonce === 326 + i &&
        exec.actor === owners[0] &&
        exec.nonce === 820 + i &&
        approve.to === safe &&
        exec.to === safe &&
        approve.data ===
          encodeFunctionData({
            abi: safeAbi,
            functionName: "approveHash",
            args: [hash],
          }) &&
        exec.data ===
          encodeFunctionData({
            abi: safeAbi,
            functionName: "execTransaction",
            args,
          }),
      "SAFE_CALLDATA_CHANGED",
    );
    operations.push({ hash, args });
  }
  for (const tx of planned)
    check(keccak256(tx.data) === tx.calldataHash, "CALLDATA_HASH_CHANGED");
  const legacy = "0xAAC59EBDE79E4e0eA0824BBE2562036b0fd5748A" as Address;
  const snapshot = async () => {
    const blockNumber = await client.getBlockNumber();
    const legacyAbi = parseAbi([
      "function root() view returns (bytes32)",
      "function nextLeafIndex() view returns (uint256)",
    ]);
    return {
      blockNumber: String(blockNumber),
      implementation: await client.getStorageAt({
        address: legacy,
        slot,
        blockNumber,
      }),
      root: await client.readContract({
        address: legacy,
        abi: legacyAbi,
        functionName: "root",
        blockNumber,
      }),
      leaves: String(
        await client.readContract({
          address: legacy,
          abi: legacyAbi,
          functionName: "nextLeafIndex",
          blockNumber,
        }),
      ),
    };
  };
  let journal: {
    proposalSha256: string;
    approvedMaxWei: string;
    approval: string;
    transactions: Entry[];
    legacyBefore: Awaited<ReturnType<typeof snapshot>>;
    legacyAfter?: Awaited<ReturnType<typeof snapshot>>;
    complete: boolean;
    totalFeeWei?: string;
  };
  try {
    journal = await json(journalFile);
  } catch (error) {
    check(
      (error as NodeJS.ErrnoException).code === "ENOENT",
      "JOURNAL_UNREADABLE",
    );
    journal = {
      proposalSha256: approvedHash,
      approvedMaxWei: String(cap),
      approval:
        "User authorized exactly 27 v2 mainnet deployment/configuration transactions, max 0.0007 ETH; no Railway, v1 changes, deposits, swaps, funding or web activation",
      transactions: [],
      legacyBefore: await snapshot(),
      complete: false,
    };
    await save(journal);
  }
  check(
    journal.proposalSha256 === approvedHash &&
      journal.approvedMaxWei === String(cap),
    "JOURNAL_APPROVAL_CHANGED",
  );
  if (journal.complete) {
    console.log("ALREADY_COMPLETE_NO_BROADCAST");
    return;
  }
  for (const account of accounts) {
    const remaining = planned.filter(
      (tx) =>
        tx.actor === account.address &&
        !journal.transactions.some(
          (r) => r.name === tx.name && r.state === "confirmed",
        ),
    );
    check(
      (await client.getBalance({ address: account.address })) >=
        remaining.reduce((n, tx) => n + BigInt(tx.gasBudget) * maxGasPrice, 0n),
      "BALANCE_INSUFFICIENT",
    );
    if (
      remaining.length &&
      !journal.transactions.some(
        (r) => r.state === "signed" && remaining.some((t) => t.name === r.name),
      )
    ) {
      check(
        (await client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        })) === remaining[0]!.nonce &&
          (await client.getTransactionCount({
            address: account.address,
            blockTag: "latest",
          })) === remaining[0]!.nonce,
        "INITIAL_ACTOR_NONCE_CHANGED",
      );
    }
  }
  for (let i = 0; i < planned.length; i++) {
    const tx = planned[i]!;
    phase = tx.name;
    let entry = journal.transactions.find((r) => r.name === tx.name);
    if (!entry) {
      const spent = journal.transactions.reduce(
        (n, r) => n + BigInt(r.feeWei ?? "0"),
        0n,
      );
      check(
        spent +
          planned
            .slice(i)
            .reduce((n, t) => n + BigInt(t.gasBudget) * maxGasPrice, 0n) <=
          cap,
        "TOTAL_BUDGET_EXCEEDED",
      );
      check(
        (await client.getTransactionCount({
          address: tx.actor,
          blockTag: "pending",
        })) === tx.nonce &&
          (await client.getTransactionCount({
            address: tx.actor,
            blockTag: "latest",
          })) === tx.nonce,
        "NONCE_CHANGED",
      );
      if (i < 7)
        check(
          !(await client.getCode({ address: predicted[tx.name]! })),
          "ADDRESS_OCCUPIED",
        );
      else {
        const opIndex = Math.floor((i - 7) / 2);
        const op = operations[opIndex]!;
        check(
          (await client.readContract({
            address: safe,
            abi: safeAbi,
            functionName: "nonce",
          })) === BigInt(20 + opIndex),
          "SAFE_NONCE_CHANGED",
        );
        if (i % 2 === 0) {
          check(
            (await client.readContract({
              address: safe,
              abi: safeAbi,
              functionName: "approvedHashes",
              args: [owners[1]!, op.hash],
            })) === 1n,
            "SAFE_APPROVAL_MISSING",
          );
          const simulation = await client.simulateContract({
            address: safe,
            abi: safeAbi,
            functionName: "execTransaction",
            args: op.args,
            account: tx.actor,
          });
          check(simulation.result === true, "SAFE_SIMULATION_FAILED");
        }
      }
      check(
        (await client.estimateGas({
          account: tx.actor,
          data: tx.data,
          ...(tx.to ? { to: tx.to } : {}),
          value: 0n,
        })) <= BigInt(tx.gasBudget),
        "ESTIMATE_OVER_APPROVED_GAS",
      );
      check((await client.getGasPrice()) <= maxGasPrice, "GAS_PRICE_OVER_CAP");
      // Fixed approved ceiling prevents small L2 base-fee moves rejecting the
      // signed transaction. All remaining gas limits are reserved at this price.
      const gasPrice = maxGasPrice;
      const account = accounts.find((a) => a.address === tx.actor)!;
      const raw = await account.signTransaction({
        chainId: 4663,
        nonce: tx.nonce,
        data: tx.data,
        ...(tx.to ? { to: tx.to } : {}),
        value: 0n,
        gas: BigInt(tx.gasBudget),
        gasPrice,
        type: "legacy",
      });
      entry = { name: tx.name, hash: keccak256(raw), state: "signed" };
      await writeFile(
        path.join(directory, `${i}.${prefix}-signed-private.json`),
        JSON.stringify({ hash: entry.hash, raw }),
        { mode: 0o600, flag: "wx" },
      );
      journal.transactions.push(entry);
      await save(journal);
      check(
        (await client.sendRawTransaction({ serializedTransaction: raw })) ===
          entry.hash,
        "BROADCAST_HASH_MISMATCH",
      );
    }
    // On resume, only reconcile the persisted hash; never silently re-sign/resubmit.
    const receipt = await client.waitForTransactionReceipt({
      hash: entry.hash,
      confirmations: 2,
      timeout: 45000,
      pollingInterval: 1000,
    });
    const actual = await client.getTransaction({ hash: entry.hash });
    check(
      actual.from.toLowerCase() === tx.actor.toLowerCase() &&
        actual.nonce === tx.nonce &&
        actual.input === tx.data &&
        actual.value === 0n &&
        (actual.to?.toLowerCase() ?? null) === (tx.to?.toLowerCase() ?? null),
      "RECEIPT_TRANSACTION_MISMATCH",
    );
    Object.assign(entry, {
      state: "confirmed",
      status: receipt.status,
      gasUsed: String(receipt.gasUsed),
      effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      contractAddress: receipt.contractAddress,
    });
    await save(journal);
    check(receipt.status === "success", "TRANSACTION_REVERTED");
    if (i < 7) {
      const address = predicted[tx.name]!;
      const immutable =
        i === 2
          ? predicted.ActionGroth16V2
          : i === 3
            ? predicted.FundGroth16V2
            : i === 5
              ? address
              : undefined;
      check(
        receipt.contractAddress?.toLowerCase() === address.toLowerCase() &&
          (await client.getCode({ address }))?.toLowerCase() ===
            runtime(artifacts[i]!, immutable).toLowerCase(),
        "DEPLOYED_RUNTIME_MISMATCH",
      );
    } else if (i % 2 === 0) {
      const op = operations[Math.floor((i - 7) / 2)]!;
      const success = receipt.logs
        .filter((log) => log.address.toLowerCase() === safe.toLowerCase())
        .some((log) => {
          try {
            const event = decodeEventLog({
              abi: safeAbi,
              topics: log.topics,
              data: log.data,
            });
            return (
              event.eventName === "ExecutionSuccess" &&
              event.args.txHash === op.hash
            );
          } catch {
            return false;
          }
        });
      check(success, "SAFE_EXECUTION_NOT_SUCCESSFUL");
    }
    if (i === 6) {
      check(
        (await read("treeVersion")) === 2n &&
          (await client.getStorageAt({ address: vault, slot })) ===
            toHex(BigInt(predicted.PrivateVaultV2!), { size: 32 }),
        "PROXY_INITIALIZER_MISMATCH",
      );
      check(
        (await read("hasRole", [toHex(0n, { size: 32 }), safe])) &&
          (await read("hasRole", [
            keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
            proposal.governance.timelock,
          ])),
        "VAULT_ROLES_MISMATCH",
      );
    }
    console.log(
      `${i + 1}/27 ${tx.name}: ${entry.hash}; fee ${formatEther(BigInt(entry.feeWei!))} ETH`,
    );
  }
  check(
    (await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "nonce",
    })) === 30n,
    "FINAL_SAFE_NONCE_MISMATCH",
  );
  for (const asset of proposal.assets)
    check(
      (await read("assetEnabled", [asset.address])) === true,
      "ASSET_NOT_ENABLED",
    );
  for (const getter of ["depositsPaused", "actionsPaused", "withdrawalsPaused"])
    check((await read(getter)) === false, "VAULT_STILL_PAUSED");
  for (const [getter, address] of [
    ["poolRegistry", manifest.contracts.PoolRegistry.proxyAddress],
    ["fieldHasher", predicted.Poseidon2FieldHasherV2],
    ["actionVerifier", predicted.PrivateActionVerifierV2],
    ["fundVerifier", predicted.PrivateFundVerifierV2],
  ])
    check(
      String(await read(getter!)).toLowerCase() ===
        String(address).toLowerCase(),
      "DEPENDENCY_MISMATCH",
    );
  journal.legacyAfter = await snapshot();
  check(
    journal.legacyBefore.implementation === journal.legacyAfter.implementation,
    "LEGACY_IMPLEMENTATION_CHANGED",
  );
  for (const item of manifests)
    check(
      (await readFile(item.file)).equals(item.bytes),
      "ACTIVE_MANIFEST_CHANGED",
    );
  journal.totalFeeWei = String(
    journal.transactions.reduce((n, r) => n + BigInt(r.feeWei!), 0n),
  );
  check(BigInt(journal.totalFeeWei) <= cap, "FEE_CAP_EXCEEDED");
  journal.complete = true;
  await save(journal);
  const report = {
    environment: "mainnet",
    chainId: 4663,
    generatedAt: new Date().toISOString(),
    proposalSha256: approvedHash,
    approvedMaxWei: String(cap),
    complete: true,
    contracts: predicted,
    assets: proposal.assets,
    transactions: journal.transactions,
    totalFeeWei: journal.totalFeeWei,
    legacyBefore: journal.legacyBefore,
    legacyAfter: journal.legacyAfter,
    railwayDeployed: false,
    activeManifestChanged: false,
    browserAcceptanceCompleted: false,
    runtimeHashes: Object.fromEntries(
      await Promise.all(
        Object.entries(predicted).map(async ([name, address]) => [
          name,
          keccak256((await client.getCode({ address }))!),
        ]),
      ),
    ),
  };
  await writeFile(
    simulation
      ? path.join(directory, "executor-fork-report.json")
      : path.join(root, "deployments/mainnet/shielded-v2.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `COMPLETE 27/27: ${formatEther(BigInt(journal.totalFeeWei))} ETH; no Railway or active manifest changes`,
  );
}
main()
  .catch((error) => {
    console.error(
      `STOPPED ${phase}: ${error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "RPC_OR_EXECUTION_FAILURE_CHECK_JOURNAL"}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (locked) await unlink(lockFile);
  });
