import {
  createWalletClient,
  http,
  keccak256,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { check, save } from "./permissionless-upgrade-support.js";

export type ReceiptRecord = {
  hash: Hex;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success" | "reverted";
};
export type UpgradeStep = {
  hash: Hex;
  rawTransaction: Hex;
  maximumFeeWei: string;
  receipt?: ReceiptRecord;
};
export type UpgradeJournal = {
  plan: { capWei: string; gasPriceCapWei: string };
  steps: Record<string, UpgradeStep>;
};
export function receiptRecord(receipt: TransactionReceipt): ReceiptRecord {
  const extra = (receipt as unknown as { l1Fee?: Hex }).l1Fee;
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress ?? null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (
      receipt.gasUsed * receipt.effectiveGasPrice +
      (extra ? BigInt(extra) : 0n)
    ).toString(),
    status: receipt.status,
  };
}
export function spentWei(journal: UpgradeJournal) {
  return Object.values(journal.steps).reduce(
    (sum, step) =>
      sum + BigInt(step.receipt?.totalFeeWei ?? step.maximumFeeWei),
    0n,
  );
}

export function boundedTransactions(input: {
  client: PublicClient;
  chain: Chain;
  rpc: string;
  journal: UpgradeJournal;
  journalFile: string;
  remainingReserve: (stage: string) => bigint;
}) {
  const { client, chain, rpc, journal, journalFile } = input;
  return async (
    stage: string,
    account: Account,
    transaction: { to?: Address; data: Hex },
  ) => {
    let step = journal.steps[stage];
    if (!step) {
      const maxFeePerGas = BigInt(journal.plan.gasPriceCapWei);
      check(
        (await client.getGasPrice()) <= maxFeePerGas,
        "GAS_PRICE_CAP_EXCEEDED",
      );
      const estimate = await client.estimateGas({
        account: account.address,
        ...transaction,
      });
      const gas = (estimate * 125n + 99n) / 100n;
      const maximumFee = gas * maxFeePerGas;
      check(
        spentWei(journal) + maximumFee + input.remainingReserve(stage) <=
          BigInt(journal.plan.capWei),
        "TOTAL_FEE_CAP_EXCEEDED",
      );
      check(
        (await client.getBalance({ address: account.address })) >= maximumFee,
        "INSUFFICIENT_GAS_BALANCE",
      );
      const wallet = createWalletClient({
        account,
        chain,
        transport: http(rpc),
      });
      const request = await wallet.prepareTransactionRequest({
        account,
        ...transaction,
        chain,
        gas,
        value: 0n,
        maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        type: "eip1559",
      });
      const raw = await wallet.signTransaction(request);
      step = {
        hash: keccak256(raw),
        rawTransaction: raw,
        maximumFeeWei: maximumFee.toString(),
      };
      journal.steps[stage] = step;
      // Persist before submission: retry can only rebroadcast the same signed hash/nonce.
      await save(journalFile, journal);
    }
    if (!step.receipt) {
      const existing = await client
        .getTransactionReceipt({ hash: step.hash })
        .catch(() => null);
      if (!existing) {
        const pending = await client
          .getTransaction({ hash: step.hash })
          .catch(() => null);
        if (!pending) {
          const submitted = await client.sendRawTransaction({
            serializedTransaction: step.rawTransaction,
          });
          check(submitted === step.hash, "TRANSACTION_HASH_MISMATCH");
        }
      }
      const receipt =
        existing ??
        (await client.waitForTransactionReceipt({
          hash: step.hash,
          confirmations: 1,
        }));
      step.receipt = receiptRecord(receipt);
      await save(journalFile, journal);
    }
    check(step.receipt.status === "success", "TRANSACTION_REVERTED_STOP");
    check(
      spentWei(journal) <= BigInt(journal.plan.capWei),
      "ACTUAL_FEE_CAP_EXCEEDED_STOP",
    );
    console.log(
      JSON.stringify({
        stage,
        receipt: step.receipt,
        cumulativeFeeWei: spentWei(journal).toString(),
      }),
    );
    return step.receipt;
  };
}
