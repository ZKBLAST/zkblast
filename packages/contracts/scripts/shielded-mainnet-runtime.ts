import { readFile, rename, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  TransactionNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation, safeOperationAbi } from "./safe-operation.js";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relative), "utf8")) as T;
}
export async function saveJson(
  relative: string,
  value: unknown,
): Promise<void> {
  const destination = path.join(root, relative);
  await writeFile(
    `${destination}.tmp`,
    `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? String(item) : item), 2)}\n`,
    { mode: 0o600 },
  );
  await rename(`${destination}.tmp`, destination);
}
export type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: {
    compiler: { version: string };
    settings: { optimizer: { enabled: boolean; runs: number } };
  };
}>;
export async function artifact(name: string): Promise<Artifact> {
  return readJson(`packages/contracts/out/${name}.sol/${name}.json`);
}
export function receiptRecord(receipt: TransactionReceipt) {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress ?? null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: String(receipt.gasUsed),
    effectiveGasPriceWei: String(receipt.effectiveGasPrice),
    totalFeeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
    status: receipt.status,
  };
}
export type ReceiptRecord = ReturnType<typeof receiptRecord>;
type Step = {
  hash: Hex;
  inputHash: Hex;
  serializedTransaction?: Hex;
  receipt?: ReceiptRecord;
};
type Journal = {
  chainId: number;
  deployer: Address;
  startNonce: number;
  steps: Record<string, Step>;
  safeIntents?: Record<string, Hex>;
};
type Plan = {
  chainId: number;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  proposedLimits: {
    approvalStatus: string;
    totalGasFeeWei: string;
    acceptanceDepositRaw: string;
  };
};

export async function runtime() {
  check(
    process.env.APP_ENV === "mainnet" && process.env.CHAIN_ID === "4663",
    "Mainnet environment required",
  );
  const plan = await readJson<Plan>(
    "deployments/mainnet/shielded-beta-plan.json",
  );
  check(
    plan.chainId === 4663 &&
      plan.proposedLimits.approvalStatus ===
        "owner-approved-in-chat-2026-10-20",
    "Explicit owner limits required",
  );
  check(
    plan.proposedLimits.totalGasFeeWei === "1000000000000000" &&
      plan.proposedLimits.acceptanceDepositRaw === "1000000",
    "Approved limits changed",
  );
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  check(key && /^0x[\da-f]{64}$/iu.test(key), "Missing deployer key");
  const account = privateKeyToAccount(key as Hex);
  check(account.address === getAddress(plan.deployer), "Wrong deployer");
  const rpc = process.env.RPC_URL;
  check(rpc, "Missing RPC");
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(rpc, { retryCount: 0, timeout: 30_000 }),
  });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpc, { retryCount: 0, timeout: 30_000 }),
  });
  check((await client.getChainId()) === 4663, "RPC chain mismatch");
  // Owner explicitly selected the same signer wallets; load only missing keys in memory.
  if (
    !process.env.GOVERNANCE_PRIVATE_KEY?.trim() ||
    !process.env.UPGRADER_PRIVATE_KEY?.trim()
  ) {
    const testnet = parseEnv(
      await readFile(path.join(root, ".env.testnet"), "utf8"),
    );
    for (const name of ["GOVERNANCE_PRIVATE_KEY", "UPGRADER_PRIVATE_KEY"])
      if (!process.env[name]?.trim()) process.env[name] = testnet[name];
  }
  const signerAddresses = [
    "GOVERNANCE_PRIVATE_KEY",
    "UPGRADER_PRIVATE_KEY",
  ].map((name) => {
    const value = process.env[name];
    check(
      value && /^0x[\da-f]{64}$/iu.test(value),
      "Two Safe signer keys required",
    );
    return privateKeyToAccount(value as Hex).address;
  });
  const [owners, threshold] = await Promise.all([
    client.readContract({
      address: plan.governance,
      abi: safeOperationAbi,
      functionName: "getOwners",
    }),
    client.readContract({
      address: plan.governance,
      abi: safeOperationAbi,
      functionName: "getThreshold",
    }),
  ]);
  check(
    threshold === 2n &&
      signerAddresses[0] !== signerAddresses[1] &&
      signerAddresses.every((signer) =>
        owners.some((owner) => getAddress(owner) === signer),
      ),
    "Mainnet Safe signer/threshold mismatch",
  );
  const journalPath = "deployments/mainnet/shielded-beta.private.json";
  let journal: Journal;
  try {
    journal = await readJson<Journal>(journalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    check(
      (await client.getTransactionCount({ address: account.address })) ===
        (await client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        })),
      "Deployer already has pending transactions",
    );
    journal = {
      chainId: 4663,
      deployer: account.address,
      startNonce: await client.getTransactionCount({
        address: account.address,
      }),
      steps: {},
    };
  }
  check(
    journal.chainId === 4663 &&
      getAddress(journal.deployer) === account.address,
    "Journal network/owner mismatch",
  );
  const save = () => saveJson(journalPath, journal);
  const spent = () =>
    Object.values(journal.steps).reduce(
      (sum, step) => sum + BigInt(step.receipt?.totalFeeWei ?? 0),
      0n,
    );
  async function send(
    label: string,
    input: { to?: Address; data: Hex },
  ): Promise<TransactionReceipt> {
    const inputHash = keccak256(
      `${input.to ?? "0x"}${input.data.slice(2)}` as Hex,
    );
    let step = journal.steps[label];
    if (step) check(step.inputHash === inputHash, "Resume input changed");
    else {
      check(process.argv.includes("--broadcast"), "Broadcast flag required");
      const expectedNonce =
        journal.startNonce + Object.keys(journal.steps).length;
      check(
        (await client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        })) === expectedNonce,
        "Unexpected deployer nonce; stop for reconciliation",
      );
      const priceCap = 40_000_000n;
      check(
        (await client.getGasPrice()) <= priceCap,
        "Gas price exceeds approved envelope",
      );
      await client.call({ account, ...input });
      const gas =
        ((await client.estimateGas({ account, ...input })) * 125n + 99n) / 100n;
      check(
        spent() + gas * priceCap <= BigInt(plan.proposedLimits.totalGasFeeWei),
        "Cumulative gas cap would be exceeded",
      );
      check(
        (await client.getBalance({ address: account.address })) >=
          gas * priceCap,
        "Insufficient native balance",
      );
      const serializedTransaction = await account.signTransaction({
        ...input,
        chainId: 4663,
        type: "eip1559",
        gas,
        nonce: expectedNonce,
        maxFeePerGas: priceCap,
        maxPriorityFeePerGas: 0n,
      });
      const hash = keccak256(serializedTransaction);
      step = { hash, inputHash, serializedTransaction };
      journal.steps[label] = step;
      await save();
    }
    if (!step.receipt) {
      let known = false;
      try {
        await client.getTransaction({ hash: step.hash });
        known = true;
      } catch (error) {
        if (!(error instanceof TransactionNotFoundError)) throw error;
      }
      if (!known) {
        check(
          process.argv.includes("--broadcast") && step.serializedTransaction,
          "Prepared transaction needs explicit broadcast",
        );
        const hash = await wallet.sendRawTransaction({
          serializedTransaction: step.serializedTransaction,
        });
        check(hash === step.hash, "Broadcast transaction hash mismatch");
      }
    }
    const receipt = await client.waitForTransactionReceipt({
      hash: step.hash,
      confirmations: 1,
      timeout: 120_000,
    });
    step.receipt = receiptRecord(receipt);
    await save();
    check(
      receipt.status === "success",
      `${label} reverted; fee accounted, no automatic retry`,
    );
    check(
      spent() <= BigInt(plan.proposedLimits.totalGasFeeWei),
      "Actual fee cap exceeded; stop",
    );
    console.log(
      JSON.stringify({
        stage: label,
        hash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: String(receipt.gasUsed),
        cumulativeGasFeeWei: String(spent()),
      }),
    );
    return receipt;
  }
  async function safeWrite(label: string, to: Address, data: Hex) {
    const intent = keccak256(`${to}${data.slice(2)}` as Hex);
    journal.safeIntents ??= {};
    if (journal.safeIntents[label])
      check(
        journal.safeIntents[label] === intent,
        "Safe resume intent changed",
      );
    else {
      journal.safeIntents[label] = intent;
      await save();
    }
    let receipt: TransactionReceipt;
    if (journal.steps[label]) {
      const previous = await client.getTransaction({
        hash: journal.steps[label].hash,
      });
      receipt = await send(label, {
        to: getAddress(plan.governance),
        data: previous.input,
      });
    } else {
      const operation = await prepareSafeOperation(client, {
        chainId: 4663,
        safe: getAddress(plan.governance),
        to,
        data,
        relayer: account,
      });
      receipt = await send(label, { to: operation.to, data: operation.data });
    }
    check(
      receipt.logs.some(
        (log) =>
          log.address.toLowerCase() === plan.governance.toLowerCase() &&
          log.topics[0] ===
            keccak256(
              new TextEncoder().encode("ExecutionSuccess(bytes32,uint256)"),
            ),
      ),
      "Safe did not emit ExecutionSuccess",
    );
    return receipt;
  }
  return { account, client, wallet, plan, journal, send, safeWrite, spent };
}
