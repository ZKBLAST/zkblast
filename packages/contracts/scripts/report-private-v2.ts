import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createPublicClient, http, formatEther, type Hex } from "viem";

// Read-only receipt reconciliation. Does not activate services or change manifests.
const root = path.resolve(import.meta.dirname, "../../..");
async function main() {
  const name = process.argv[2];
  if (
    !/^browser-stage-[\w-]+$/u.test(name ?? "") ||
    process.env.APP_ENV !== "testnet" ||
    process.env.CHAIN_ID !== "46630" ||
    !process.env.RPC_URL
  )
    throw new Error("TESTNET_STAGE_REQUIRED");
  const directory = path.join(
    root,
    "packages/circuits/target/v2-testnet",
    name!,
  );
  const load = async (file: string) =>
    JSON.parse(await readFile(path.join(directory, file), "utf8"));
  const journal = await load("broadcast-execution.json");
  const stage = await load("staging.json");
  const proposalBytes = await readFile(
    path.join(directory, "broadcast-proposal.json"),
  );
  const proposal = JSON.parse(proposalBytes.toString());
  if (
    !journal.complete ||
    journal.transactions.length !== 14 ||
    journal.proposalSha256 !==
      createHash("sha256").update(proposalBytes).digest("hex")
  )
    throw new Error("COMPLETE_APPROVED_JOURNAL_REQUIRED");
  const client = createPublicClient({
    transport: http(process.env.RPC_URL, { retryCount: 0, timeout: 20000 }),
  });
  if ((await client.getChainId()) !== 46630) throw new Error("CHAIN_MISMATCH");
  const transactions = [];
  for (let i = 0; i < 14; i++) {
    const record = journal.transactions[i];
    const planned = proposal.transactions[i];
    const receipt = await client.getTransactionReceipt({
      hash: record.hash as Hex,
    });
    if (
      record.name !== planned.name ||
      receipt.status !== "success" ||
      receipt.from.toLowerCase() !== planned.actor.toLowerCase() ||
      (receipt.to ?? "").toLowerCase() !== (planned.to ?? "").toLowerCase() ||
      receipt.gasUsed * receipt.effectiveGasPrice !== BigInt(record.feeWei)
    )
      throw new Error("RECEIPT_MISMATCH");
    transactions.push({
      name: record.name,
      hash: receipt.transactionHash,
      from: receipt.from,
      to: receipt.to,
      nonce: planned.nonce,
      contractAddress: receipt.contractAddress,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      gasUsed: String(receipt.gasUsed),
      effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      totalFeeWei: record.feeWei,
      status: receipt.status,
    });
  }
  const totalFeeWei = transactions.reduce(
    (sum, tx) => sum + BigInt(tx.totalFeeWei),
    0n,
  );
  if (totalFeeWei > 300_000_000_000_000n) throw new Error("FEE_CAP_EXCEEDED");
  const { blockNumber: _beforeBlock, ...before } = journal.legacyBefore;
  const { blockNumber: _afterBlock, ...after } = journal.legacyAfter;
  const report = {
    environment: "testnet",
    chainId: 46630,
    generatedAt: new Date().toISOString(),
    complete: true,
    proposalSha256: journal.proposalSha256,
    approvedMaxWei: journal.approvedMaxWei,
    totalFeeWei: String(totalFeeWei),
    totalFeeEth: formatEther(totalFeeWei),
    gasUsed: String(
      transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n),
    ),
    addresses: stage.predicted,
    admin: stage.admin,
    upgrader: stage.upgrader,
    upgraderDelaySeconds: 300,
    treeVersion: 2,
    deploymentBlock: transactions[6]!.blockNumber,
    proverRelease: stage.reference,
    assets: (await load("deployment-rehearsal.json")).assets,
    legacyBefore: journal.legacyBefore,
    legacyAfter: journal.legacyAfter,
    legacySnapshotUnchanged: JSON.stringify(before) === JSON.stringify(after),
    transactions,
    runtimeAndInitializerVerified: true,
    railwayDeployed: false,
    activeManifestChanged: false,
    browserAcceptanceComplete: false,
    mainnetAuthorized: false,
  };
  await writeFile(
    path.join(root, "deployments/testnet/shielded-v2.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `RECONCILED 14/14; fee ${report.totalFeeEth} ETH; v1 unchanged: ${report.legacySnapshotUnchanged}`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]+$/u.test(error.message)
      ? error.message
      : "READ_ONLY_RECONCILIATION_FAILED",
  );
  process.exitCode = 1;
});
