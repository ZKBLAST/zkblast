import { readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  http,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// One explicitly diagnosed, rejected nonce-401 submission only. Same calldata,
// value, chain, actor and gas limit; price stays within the existing total cap.
const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(
  root,
  "packages/circuits/target/v2-mainnet/candidate-s5KJOD",
);
const journalFile = path.join(dir, "mainnet-execution.json");
const lockFile = path.join(dir, "mainnet-execution.lock");
const oldHash =
  "0x9114f9cf9c9f16adc18a114c700399b3f74f22b696292d670eef3d490ef78185";
const maxPrice = 40_012_000n;
let locked = false;
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
async function main() {
  check(
    process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL &&
      process.argv[2] === "--same-nonce-within-approved-cap",
    "MAINNET_APPROVAL_REQUIRED",
  );
  const lock = await open(lockFile, "wx", 0o600);
  locked = true;
  await lock.close();
  const proposalBytes = await readFile(path.join(dir, "mainnet-proposal.json"));
  check(
    createHash("sha256").update(proposalBytes).digest("hex") ===
      "b874aaa9ef5a6e5d304d0dda0a8b64d9e4114eb6c87e42f3eef55b42e4585661",
    "PROPOSAL_CHANGED",
  );
  const proposal = JSON.parse(proposalBytes.toString());
  const journal = JSON.parse(await readFile(journalFile, "utf8"));
  const signed = JSON.parse(
    await readFile(path.join(dir, "0.mainnet-signed-private.json"), "utf8"),
  );
  check(
    journal.transactions.length === 1 &&
      journal.transactions[0].hash === oldHash &&
      journal.transactions[0].state === "signed" &&
      keccak256(signed.raw) === oldHash,
    "RECONCILIATION_SCOPE_CHANGED",
  );
  check(
    proposal.transactions.reduce(
      (n: bigint, tx: { gasBudget: string }) =>
        n + BigInt(tx.gasBudget) * maxPrice,
      0n,
    ) <= 700_000_000_000_000n,
    "APPROVED_CAP_EXCEEDED",
  );
  const old = parseTransaction(signed.raw);
  const tx = proposal.transactions[0];
  check(
    old.chainId === 4663 &&
      old.nonce === 401 &&
      old.data === tx.data &&
      !old.to &&
      (old.value ?? 0n) === 0n &&
      old.gas === BigInt(tx.gasBudget),
    "SIGNED_SCOPE_CHANGED",
  );
  const client = createPublicClient({
    transport: http(process.env.RPC_URL, { retryCount: 0 }),
  });
  check((await client.getChainId()) === 4663, "CHAIN_CHANGED");
  try {
    await client.getTransaction({ hash: oldHash });
    throw new Error("ORIGINAL_TRANSACTION_EXISTS");
  } catch (error) {
    check(
      (error as Error).name === "TransactionNotFoundError",
      "ORIGINAL_SUBMISSION_UNCERTAIN",
    );
  }
  for (const blockTag of ["latest", "pending"] as const)
    check(
      (await client.getTransactionCount({ address: tx.actor, blockTag })) ===
        401,
      "NONCE_CHANGED",
    );
  const block = await client.getBlock();
  check(
    block.baseFeePerGas &&
      old.gasPrice! < block.baseFeePerGas &&
      block.baseFeePerGas <= maxPrice &&
      (await client.getGasPrice()) <= maxPrice,
    "REJECTED_BASE_FEE_REASON_NOT_CONFIRMED",
  );
  check(
    (await client.estimateGas({
      account: tx.actor,
      data: tx.data,
      value: 0n,
    })) <= BigInt(tx.gasBudget),
    "ESTIMATE_OVER_CAP",
  );
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  check(account.address === tx.actor, "SIGNER_CHANGED");
  const raw = await account.signTransaction({
    chainId: 4663,
    nonce: 401,
    data: tx.data,
    value: 0n,
    gas: BigInt(tx.gasBudget),
    gasPrice: maxPrice,
    type: "legacy",
  });
  const hash = keccak256(raw);
  await writeFile(
    path.join(dir, "0.mainnet-repriced-private.json"),
    JSON.stringify({ hash, raw }),
    { mode: 0o600, flag: "wx" },
  );
  journal.transactions[0] = {
    name: tx.name,
    hash,
    state: "signed",
    supersededRejectedSubmission: {
      hash: oldHash,
      reason:
        "RPC rejected: max fee below block base fee; not found and both nonces 401 before bounded same-nonce replacement",
      oldGasPriceWei: String(old.gasPrice),
      gasPriceWei: String(maxPrice),
    },
  };
  await writeFile(
    `${journalFile}.tmp`,
    JSON.stringify(journal, null, 2) + "\n",
    { mode: 0o600 },
  );
  await rename(`${journalFile}.tmp`, journalFile);
  check(
    (await client.sendRawTransaction({ serializedTransaction: raw })) === hash,
    "SUBMISSION_HASH_MISMATCH",
  );
  console.log(
    `SAME_NONCE_401_SUBMITTED ${hash}; reserved total remains below 0.0007 ETH`,
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "RECOVERY_RPC_FAILURE_CHECK_JOURNAL",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (locked) await unlink(lockFile);
  });
