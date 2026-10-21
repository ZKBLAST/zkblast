import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
  formatEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// This executor only accepts the fourteen individually rehearsed testnet calls.
const root = path.resolve(import.meta.dirname, "../../..");
const stageName = process.argv[2];
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
check(
  /^browser-stage-[\w-]+$/u.test(stageName ?? ""),
  "EXPLICIT_STAGE_REQUIRED",
);
const stage = path.join(
  root,
  "packages/circuits/target/v2-testnet",
  stageName!,
);
const journalFile = path.join(stage, "broadcast-execution.json");
const lockFile = path.join(stage, "broadcast.lock");
const maxFee = 20_000_000n;
const cap = 300_000_000_000_000n;
const slot: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
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
type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  metadata: { sources: Record<string, { keccak256: Hex }> };
};
type Transaction = {
  name: string;
  actor: Address;
  nonce: number;
  to: Address | null;
  data: Hex;
  calldataHash: Hex;
  gasBudget: string;
};
type RecordEntry = {
  name: string;
  hash: Hex;
  state: "signed" | "confirmed";
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  feeWei?: string;
  blockNumber?: string;
  contractAddress?: Address | null;
  status?: string;
};
type Journal = {
  proposalSha256: string;
  approvedMaxWei: string;
  approval: string;
  transactions: RecordEntry[];
  legacyBefore?: unknown;
  legacyAfter?: unknown;
  complete: boolean;
  totalFeeWei?: string;
};
let phase = "load";
let locked = false;
async function json(filename: string) {
  return JSON.parse(await readFile(filename, "utf8"));
}
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
    process.env.APP_ENV === "testnet" &&
      process.env.CHAIN_ID === "46630" &&
      process.env.RPC_URL,
    "TESTNET_ONLY",
  );
  check(
    process.argv[3] === "--approved-0.0003-eth",
    "EXPLICIT_APPROVAL_REQUIRED",
  );
  const lock = await open(lockFile, "wx", 0o600);
  locked = true;
  await lock.close();
  const staged = await json(path.join(stage, "staging.json"));
  const rehearsal = await json(path.join(stage, "deployment-rehearsal.json"));
  const verification = await json(
    path.join(stage, "artifact-verification.json"),
  );
  check(
    rehearsal.deploymentVerifiedOnForkOnly &&
      rehearsal.v1ForkStateUnchanged &&
      verification.results.length === 2 &&
      verification.results.every(
        (r: { zkeyVerifiedAgainstR1cs: boolean }) => r.zkeyVerifiedAgainstR1cs,
      ),
    "REHEARSAL_REQUIRED",
  );
  const proposalBytes = await readFile(
    path.join(stage, "broadcast-proposal.json"),
  );
  const proposal = JSON.parse(proposalBytes.toString());
  const proposalSha256 = createHash("sha256")
    .update(proposalBytes)
    .digest("hex");
  check(
    proposal.environment === "testnet" &&
      proposal.chainId === 46630 &&
      proposal.transactions.length === 14 &&
      BigInt(proposal.maxFeePerGasWei) === maxFee,
    "PROPOSAL_SCOPE_INVALID",
  );
  const transactions = proposal.transactions as Transaction[];
  check(
    transactions.reduce((n, t) => n + BigInt(t.gasBudget) * maxFee, 0n) ===
      BigInt(proposal.totalFeeCapWei) && BigInt(proposal.totalFeeCapWei) <= cap,
    "PROPOSAL_CAP_INVALID",
  );
  const manifestFile = path.join(root, "deployments/testnet/manifest.json");
  const manifestBytes = await readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes.toString());
  const actors = ["DEPLOYER_PRIVATE_KEY", "GOVERNANCE_PRIVATE_KEY"].map(
    (name) => {
      const key = process.env[name];
      check(/^0x[0-9a-fA-F]{64}$/u.test(key ?? ""), "SIGNER_KEY_REQUIRED");
      return privateKeyToAccount(key as Hex);
    },
  );
  check(
    actors[0]!.address === staged.deployer &&
      actors[1]!.address === staged.admin,
    "SIGNER_MISMATCH",
  );
  const artifacts: Record<string, Artifact> = {};
  for (const [name, file] of files) {
    const artifact = (await json(
      path.join(root, "packages/contracts/out", file),
    )) as Artifact;
    for (const [source, metadata] of Object.entries(
      artifact.metadata.sources,
    )) {
      const filename = path.resolve(root, "packages/contracts", source);
      check(
        filename.startsWith(`${root}/`) &&
          keccak256(await readFile(filename)) === metadata.keccak256,
        "SOURCE_CHANGED",
      );
    }
    artifacts[name] = artifact;
  }
  const abi = artifacts.PrivateVaultV2!.abi;
  const vault: Address = staged.predicted.PrivateVaultV2Proxy;
  const init = encodeFunctionData({
    abi,
    functionName: "initialize",
    args: [
      staged.admin,
      staged.upgrader,
      staged.registry,
      staged.predicted.Poseidon2FieldHasherV2,
      staged.predicted.PrivateActionVerifierV2,
      staged.predicted.PrivateFundVerifierV2,
      2n,
    ],
  });
  files.forEach(([name], i) => {
    const tx = transactions[i]!;
    const args =
      name === "PrivateActionVerifierV2"
        ? [staged.predicted.ActionGroth16V2]
        : name === "PrivateFundVerifierV2"
          ? [staged.predicted.FundGroth16V2]
          : name === "PrivateVaultV2Proxy"
            ? [staged.predicted.PrivateVaultV2, init]
            : [];
    const data = encodeDeployData({
      abi: artifacts[name]!.abi,
      bytecode: artifacts[name]!.bytecode.object,
      args,
    });
    check(
      tx.name === name &&
        tx.actor === staged.deployer &&
        tx.to === null &&
        tx.nonce === staged.observedPendingNonce + i &&
        tx.data === data &&
        keccak256(data) === tx.calldataHash,
      "DEPLOYMENT_PROPOSAL_CHANGED",
    );
  });
  check(rehearsal.assets.length === 6, "ASSET_COUNT_CHANGED");
  for (let i = 7; i < 14; i++) {
    const tx = transactions[i]!;
    const asset = rehearsal.assets[i - 7];
    const data =
      i === 13
        ? encodeFunctionData({
            abi,
            functionName: "setPaused",
            args: [false, false, false],
          })
        : encodeFunctionData({
            abi,
            functionName: "setAssetEnabled",
            args: [asset.address, true],
          });
    check(
      tx.name ===
        (i === 13 ? "enable-v2-operations" : `enable-${asset.symbol}`) &&
        tx.to === vault &&
        tx.actor === staged.admin &&
        tx.data === data &&
        keccak256(data) === tx.calldataHash &&
        tx.nonce === transactions[7]!.nonce + i - 7,
      "CONFIG_PROPOSAL_CHANGED",
    );
  }
  const candidate = await readFile(
    path.join(stage, "public/zk/testnet/v2/manifest.json"),
  );
  check(
    createHash("sha256").update(candidate).digest("hex") ===
      staged.reference.manifestSha256,
    "PROVER_MANIFEST_CHANGED",
  );
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20000, retryCount: 0 }),
  });
  check((await client.getChainId()) === 46630, "REMOTE_CHAIN_MISMATCH");
  const read = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: vault, abi, functionName, args });
  const legacyAbi = (
    await json(
      path.join(
        root,
        "packages/contracts/out/ZKBlastVault.sol/ZKBlastVault.json",
      ),
    )
  ).abi as Abi;
  const legacyAddress = rehearsal.legacyBefore.vault as Address;
  check(legacyAddress.toLowerCase() !== vault.toLowerCase(), "V1_V2_COLLISION");
  const legacySnapshot = async () => {
    const blockNumber = await client.getBlockNumber();
    return {
      blockNumber: String(blockNumber),
      implementation: await client.getStorageAt({
        address: legacyAddress,
        slot,
        blockNumber,
      }),
      root: String(
        await client.readContract({
          address: legacyAddress,
          abi: legacyAbi,
          functionName: "root",
          blockNumber,
        }),
      ),
      leaves: String(
        await client.readContract({
          address: legacyAddress,
          abi: legacyAbi,
          functionName: "nextLeafIndex",
          blockNumber,
        }),
      ),
      balances: await Promise.all(
        manifest.shielded.assets.map(async (asset: { address: Address }) => ({
          address: asset.address,
          raw: String(
            await client.readContract({
              address: asset.address,
              abi: parseAbi([
                "function balanceOf(address) view returns (uint256)",
              ]),
              functionName: "balanceOf",
              args: [legacyAddress],
              blockNumber,
            }),
          ),
        })),
      ),
    };
  };
  let journal: Journal;
  try {
    journal = await json(journalFile);
  } catch (error) {
    check(
      (error as NodeJS.ErrnoException).code === "ENOENT",
      "JOURNAL_UNREADABLE",
    );
    journal = {
      proposalSha256,
      approvedMaxWei: String(cap),
      approval:
        "User approved 7 deployments + 7 v2-only configurations, testnet only, max 0.0003 ETH; no Railway or v1 changes",
      transactions: [],
      complete: false,
      legacyBefore: await legacySnapshot(),
    };
    await save(journal);
  }
  check(
    journal.proposalSha256 === proposalSha256 &&
      journal.approvedMaxWei === String(cap),
    "JOURNAL_APPROVAL_MISMATCH",
  );
  if (journal.complete) {
    console.log("ALREADY_COMPLETE: no additional transactions sent.");
    return;
  }
  phase = "timelock";
  const timelockCode = await client.getCode({ address: staged.upgrader });
  check(
    timelockCode &&
      keccak256(timelockCode) === staged.upgraderResolution.runtimeCodeHash,
    "TIMELOCK_CODE_CHANGED",
  );
  check(
    (await client.readContract({
      address: staged.upgrader,
      abi: parseAbi(["function getMinDelay() view returns (uint256)"]),
      functionName: "getMinDelay",
    })) === 300n,
    "TIMELOCK_DELAY_CHANGED",
  );
  for (const actor of actors) {
    const planned = transactions.filter((t) => t.actor === actor.address);
    const confirmed = journal.transactions.filter(
      (r) => r.state === "confirmed" && planned.some((t) => t.name === r.name),
    ).length;
    const signed = journal.transactions.find(
      (r) => r.state === "signed" && planned.some((t) => t.name === r.name),
    );
    if (!signed)
      check(
        (await client.getTransactionCount({
          address: actor.address,
          blockTag: "pending",
        })) ===
          planned[0]!.nonce + confirmed &&
          (await client.getTransactionCount({
            address: actor.address,
            blockTag: "latest",
          })) ===
            planned[0]!.nonce + confirmed,
        "ACTOR_NONCE_CHANGED",
      );
    const reserve = planned
      .filter(
        (t) =>
          !journal.transactions.some(
            (r) => r.name === t.name && r.state === "confirmed",
          ),
      )
      .reduce((n, t) => n + BigInt(t.gasBudget) * maxFee, 0n);
    check(
      (await client.getBalance({ address: actor.address })) >= reserve,
      "ACTOR_BALANCE_LOW",
    );
  }
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]!;
    phase = tx.name;
    let record = journal.transactions.find((r) => r.name === tx.name);
    if (!record) {
      const spent = journal.transactions.reduce(
        (n, r) => n + BigInt(r.feeWei ?? "0"),
        0n,
      );
      const reserve = transactions
        .slice(i)
        .reduce((n, t) => n + BigInt(t.gasBudget) * maxFee, 0n);
      check(spent + reserve <= cap, "TOTAL_FEE_CAP_EXCEEDED");
      check((await client.getGasPrice()) <= maxFee, "GAS_PRICE_OVER_CAP");
      check(
        (await client.getTransactionCount({
          address: tx.actor,
          blockTag: "pending",
        })) === tx.nonce,
        "ACTOR_NONCE_CHANGED",
      );
      if (i < 7)
        check(
          !(await client.getCode({ address: staged.predicted[tx.name] })),
          "DEPLOYMENT_ADDRESS_OCCUPIED",
        );
      const estimated = await client.estimateGas({
        account: tx.actor,
        data: tx.data,
        ...(tx.to ? { to: tx.to } : {}),
        value: 0n,
      });
      check(estimated <= BigInt(tx.gasBudget), "ESTIMATE_OVER_APPROVED_GAS");
      const actor = actors.find((a) => a.address === tx.actor)!;
      // Legacy fixed gas price also caps every transaction's total execution fee.
      const gasPrice = await client.getGasPrice();
      check(gasPrice <= maxFee, "GAS_PRICE_OVER_CAP");
      const raw = await actor.signTransaction({
        chainId: 46630,
        nonce: tx.nonce,
        data: tx.data,
        ...(tx.to ? { to: tx.to } : {}),
        value: 0n,
        gas: BigInt(tx.gasBudget),
        gasPrice,
        type: "legacy",
      });
      record = { name: tx.name, hash: keccak256(raw), state: "signed" };
      await writeFile(
        path.join(stage, `${i}.signed-private.json`),
        JSON.stringify({ hash: record.hash, raw }),
        { mode: 0o600, flag: "wx" },
      );
      journal.transactions.push(record);
      await save(journal);
      check(
        (await client.sendRawTransaction({ serializedTransaction: raw })) ===
          record.hash,
        "BROADCAST_HASH_MISMATCH",
      );
    }
    const receipt = await client.waitForTransactionReceipt({
      hash: record.hash,
      confirmations: 2,
      timeout: 60000,
      pollingInterval: 1500,
    });
    Object.assign(record, {
      state: "confirmed",
      gasUsed: String(receipt.gasUsed),
      effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      blockNumber: String(receipt.blockNumber),
      contractAddress: receipt.contractAddress,
      status: receipt.status,
    });
    await save(journal);
    check(receipt.status === "success", "TRANSACTION_REVERTED");
    if (i < 7) {
      const address = staged.predicted[tx.name] as Address;
      check(
        receipt.contractAddress?.toLowerCase() === address.toLowerCase(),
        "DEPLOYED_ADDRESS_MISMATCH",
      );
      const immutable =
        i === 2
          ? staged.predicted.ActionGroth16V2
          : i === 3
            ? staged.predicted.FundGroth16V2
            : i === 5
              ? address
              : undefined;
      check(
        (await client.getCode({ address }))?.toLowerCase() ===
          runtime(artifacts[tx.name]!, immutable).toLowerCase(),
        "RUNTIME_MISMATCH",
      );
    }
    if (
      i === 6 &&
      !journal.transactions.some(
        (r) => r.name === "enable-v2-operations" && r.state === "confirmed",
      )
    ) {
      check(
        (await read("treeVersion")) === 2n &&
          (await read("depositsPaused")) === true &&
          (await read("actionsPaused")) === true,
        "INITIALIZER_STATE_MISMATCH",
      );
      for (const [getter, expected] of [
        ["poolRegistry", staged.registry],
        ["fieldHasher", staged.predicted.Poseidon2FieldHasherV2],
        ["actionVerifier", staged.predicted.PrivateActionVerifierV2],
        ["fundVerifier", staged.predicted.PrivateFundVerifierV2],
      ])
        check(
          String(await read(getter!)).toLowerCase() === expected.toLowerCase(),
          "DEPENDENCY_MISMATCH",
        );
      check(
        (await client.getStorageAt({ address: vault, slot })) ===
          toHex(BigInt(staged.predicted.PrivateVaultV2), { size: 32 }),
        "PROXY_IMPLEMENTATION_MISMATCH",
      );
      check(
        (await read("hasRole", [toHex(0n, { size: 32 }), staged.admin])) &&
          (await read("hasRole", [
            keccak256(new TextEncoder().encode("ZKBLAST_UPGRADER_ROLE")),
            staged.upgrader,
          ])),
        "VAULT_ROLE_MISMATCH",
      );
    }
    if (i >= 7 && i < 13)
      check(
        (await read("assetEnabled", [rehearsal.assets[i - 7].address])) ===
          true,
        "ASSET_NOT_ENABLED",
      );
    console.log(
      `${i + 1}/14 ${tx.name}: ${record.hash}; fee ${formatEther(BigInt(record.feeWei!))} ETH`,
    );
  }
  check(
    (await read("depositsPaused")) === false &&
      (await read("actionsPaused")) === false &&
      (await read("withdrawalsPaused")) === false,
    "V2_PAUSED",
  );
  journal.legacyAfter = await legacySnapshot();
  check(
    (journal.legacyBefore as { implementation: string }).implementation ===
      (journal.legacyAfter as { implementation: string }).implementation,
    "V1_IMPLEMENTATION_CHANGED",
  );
  check(
    (await readFile(manifestFile)).equals(manifestBytes),
    "LEGACY_MANIFEST_CHANGED",
  );
  journal.totalFeeWei = String(
    journal.transactions.reduce((n, r) => n + BigInt(r.feeWei!), 0n),
  );
  check(BigInt(journal.totalFeeWei) <= cap, "FEE_CAP_EXCEEDED");
  journal.complete = true;
  await save(journal);
  console.log(
    `COMPLETE: 14/14; total ${formatEther(BigInt(journal.totalFeeWei))} ETH. Railway and active manifest unchanged.`,
  );
}
main()
  .catch((error) => {
    const code =
      error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "RPC_OR_EXECUTION_FAILURE_CHECK_JOURNAL";
    console.error(`Stopped at ${phase}: ${code}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (locked) await unlink(lockFile);
  });
