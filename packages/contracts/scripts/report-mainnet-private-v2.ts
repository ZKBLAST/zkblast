import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  formatEther,
  type Address,
  type Hex,
} from "viem";

// Independent read-only receipt reconciliation. Never signs or submits a call.
const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(
  root,
  "packages/circuits/target/v2-mainnet/candidate-s5KJOD",
);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
async function main() {
  check(
    process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL,
    "MAINNET_ONLY",
  );
  const journal = await json(path.join(dir, "mainnet-execution.json"));
  const proposal = await json(path.join(dir, "mainnet-proposal.json"));
  const reportFile = path.join(root, "deployments/mainnet/shielded-v2.json");
  const report = await json(reportFile);
  check(
    journal.complete && journal.transactions.length === 27 && report.complete,
    "COMPLETE_BROADCAST_REQUIRED",
  );
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { retryCount: 0 }),
  });
  check((await client.getChainId()) === 4663, "CHAIN_MISMATCH");
  let total = 0n;
  const transactions = [];
  const fees = new Map<Address, bigint>();
  for (let i = 0; i < 27; i++) {
    const entry = journal.transactions[i];
    const planned = proposal.transactions[i];
    const receipt = await client.getTransactionReceipt({ hash: entry.hash });
    const tx = await client.getTransaction({ hash: entry.hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    check(
      receipt.status === "success" &&
        receipt.blockHash === block.hash &&
        entry.blockHash === block.hash &&
        tx.from.toLowerCase() === planned.actor.toLowerCase() &&
        tx.nonce === planned.nonce &&
        tx.input === planned.data &&
        tx.value === 0n &&
        (tx.to?.toLowerCase() ?? null) ===
          (planned.to?.toLowerCase() ?? null) &&
        tx.gas === BigInt(planned.gasBudget),
      "RECEIPT_RECONCILIATION_MISMATCH",
    );
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    check(
      fee === BigInt(entry.feeWei) &&
        receipt.effectiveGasPrice <= 40_012_000n &&
        receipt.gasUsed <= tx.gas,
      "FEE_RECONCILIATION_MISMATCH",
    );
    total += fee;
    fees.set(planned.actor, (fees.get(planned.actor) ?? 0n) + fee);
    transactions.push({
      ...entry,
      actor: planned.actor,
      nonce: tx.nonce,
      to: tx.to,
      valueWei: "0",
      calldataHash: keccak256(tx.input),
      gasLimit: String(tx.gas),
      timestampUtc: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
  }
  check(
    total === BigInt(journal.totalFeeWei) && total <= 700_000_000_000_000n,
    "TOTAL_FEE_MISMATCH",
  );
  const verifiedBlock = await client.getBlockNumber();
  const actors = [];
  for (const [address, fee] of fees) {
    const planned = proposal.transactions.filter(
      (tx: { actor: Address }) => tx.actor === address,
    );
    const expectedNonce = planned.at(-1).nonce + 1;
    const latest = await client.getTransactionCount({ address });
    const pending = await client.getTransactionCount({
      address,
      blockTag: "pending",
    });
    check(
      latest === expectedNonce && pending === expectedNonce,
      "FINAL_ACTOR_NONCE_MISMATCH",
    );
    actors.push({
      address,
      confirmedNonce: latest,
      pendingNonce: pending,
      totalFeeWei: String(fee),
      balanceWei: String(await client.getBalance({ address })),
    });
  }
  const contracts = report.contracts;
  const runtimeHashes: Record<string, Hex> = {};
  for (const [name, address] of Object.entries(contracts) as [
    string,
    Address,
  ][]) {
    const code = await client.getCode({ address, blockNumber: verifiedBlock });
    check(code && code !== "0x", "RUNTIME_MISSING");
    const hash = keccak256(code);
    check(hash === report.runtimeHashes[name], "RUNTIME_CHANGED");
    runtimeHashes[name] = hash;
  }
  const proxy = transactions[6]!;
  const verifiedDeployment = {
    chainId: 4663,
    transactionHash: proxy.hash,
    verifiedBlock: Number(verifiedBlock),
    implementation: contracts.PrivateVaultV2,
    proxyRuntimeHash: runtimeHashes.PrivateVaultV2Proxy,
    implementationRuntimeHash: runtimeHashes.PrivateVaultV2,
    fieldHasherRuntimeHash: runtimeHashes.Poseidon2FieldHasherV2,
    actionAdapterRuntimeHash: runtimeHashes.PrivateActionVerifierV2,
    fundAdapterRuntimeHash: runtimeHashes.PrivateFundVerifierV2,
    actionGroth16RuntimeHash: runtimeHashes.ActionGroth16V2,
    fundGroth16RuntimeHash: runtimeHashes.FundGroth16V2,
  };
  const abi = parseAbi([
    "function treeVersion() view returns (uint256)",
    "function nextLeafIndex() view returns (uint256)",
    "function depositsPaused() view returns (bool)",
    "function actionsPaused() view returns (bool)",
    "function withdrawalsPaused() view returns (bool)",
  ]);
  const read = (
    functionName:
      | "treeVersion"
      | "nextLeafIndex"
      | "depositsPaused"
      | "actionsPaused"
      | "withdrawalsPaused",
  ) =>
    client.readContract({
      address: contracts.PrivateVaultV2Proxy,
      abi,
      functionName,
      blockNumber: verifiedBlock,
    });
  check(
    (await read("treeVersion")) === 2n && (await read("nextLeafIndex")) === 0n,
    "NEW_VAULT_NOT_EMPTY_V2",
  );
  for (const getter of [
    "depositsPaused",
    "actionsPaused",
    "withdrawalsPaused",
  ] as const)
    check((await read(getter)) === false, "V2_NOT_ENABLED");
  Object.assign(report, {
    transactions,
    actors,
    verifiedDeployment,
    deploymentBlock: Number(proxy.blockNumber),
    receiptReconciliation: {
      complete: true,
      verifiedAt: new Date().toISOString(),
      verifiedBlock: Number(verifiedBlock),
      canonicalReceipts: 27,
      chainId: 4663,
      treeVersion: 2,
      nextLeafIndex: 0,
      noAcceptanceTransactionsPerformed: true,
    },
    totalFeeEth: formatEther(total),
    remainingApprovedBudgetEth: formatEther(700_000_000_000_000n - total),
  });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        reconciled: "27/27",
        verifiedBlock: String(verifiedBlock),
        totalFeeEth: report.totalFeeEth,
        remainingApprovedBudgetEth: report.remainingApprovedBudgetEth,
        actors,
        activeManifestChanged: false,
        railwayDeployed: false,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "READ_ONLY_RECONCILIATION_FAILURE",
  );
  process.exitCode = 1;
});
