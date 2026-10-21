import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  concatHex,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeSafeOwners } from "./private-v2-safe-owners.js";

const root = path.resolve(import.meta.dirname, "../../..");
const evidence = path.join(
  root,
  "packages/circuits/target/v2-mainnet/candidate-s5KJOD",
);
const journalFile = path.join(evidence, "pons-enable-execution.json");
const lockFile = path.join(evidence, "pons-enable.lock");
const cap = 7_054_894_972_000n;
const gasPrice = 40_028_000n;
const approveGas = 65_980n;
const executeGas = 110_269n;
const safe = getAddress("0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8");
const vault = getAddress("0x81d7EaA9B144e58D6Ce0e0e7e04876d5aeDe8cb4");
const pons = getAddress("0x39dBED3a2bd333467115dE45665cC57F813C4571");
const expectedOwners = normalizeSafeOwners([
  "0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9",
  "0x48e7BcFE8F469FBc72E6BcEf0D0cE70d51FFBbed",
]);
const safeAbi = parseAbi([
  "function nonce() view returns(uint256)",
  "function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)",
  "function approvedHashes(address,bytes32) view returns(uint256)",
  "function approveHash(bytes32)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
]);
const vaultAbi = parseAbi([
  "function setAssetEnabled(address,bool)",
  "function assetEnabled(address) view returns(bool)",
]);
type Entry = {
  name: string;
  hash: Hex;
  state: "signed" | "confirmed";
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  feeWei?: string;
  blockNumber?: string;
  blockHash?: Hex;
};
type Journal = {
  approval: string;
  approvedMaxWei: string;
  safeTransactionHash: Hex;
  transactions: Entry[];
  complete: boolean;
  totalFeeWei?: string;
};
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
let locked = false;
let phase = "preflight";
async function save(journal: Journal) {
  await writeFile(
    `${journalFile}.tmp`,
    `${JSON.stringify(journal, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(`${journalFile}.tmp`, journalFile);
}
async function main() {
  check(
    process.argv[2] === "--approved-max-0.000007054894972-eth" &&
      process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL,
    "EXPLICIT_PONS_APPROVAL_REQUIRED",
  );
  check((approveGas + executeGas) * gasPrice === cap, "CAP_MATH_CHANGED");
  const lock = await open(lockFile, "wx", 0o600);
  locked = true;
  await lock.close();
  const plan = JSON.parse(
    await readFile(
      path.join(root, "deployments/mainnet/shielded-v2-pons-plan.json"),
      "utf8",
    ),
  );
  check(
    plan.broadcastAllowed === false &&
      plan.liveTransactionsBroadcast === 0 &&
      plan.governance.safeNonce === 30 &&
      plan.governance.approverNonce === 336 &&
      plan.governance.executorNonce === 830 &&
      BigInt(plan.gas.proposedTotalFeeCapWei) === cap,
    "PLAN_CHANGED",
  );
  const keys = ["GOVERNANCE_PRIVATE_KEY", "UPGRADER_PRIVATE_KEY"].map(
    (name) => {
      const key = process.env[name]?.trim();
      check(
        /^0x[0-9a-fA-F]{64}$/u.test(key ?? ""),
        "MAINNET_OWNER_KEY_REQUIRED",
      );
      return privateKeyToAccount(key as Hex);
    },
  );
  check(
    keys[0]!.address === expectedOwners[0] &&
      keys[1]!.address === expectedOwners[1],
    "OWNER_KEY_MISMATCH",
  );
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 0 }),
  });
  check((await client.getChainId()) === 4663, "CHAIN_CHANGED");
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
      ) === JSON.stringify(expectedOwners),
    "SAFE_OWNERS_CHANGED",
  );
  const inner = encodeFunctionData({
    abi: vaultAbi,
    functionName: "setAssetEnabled",
    args: [pons, true],
  });
  const safeHashArgs = [
    vault,
    0n,
    inner,
    0,
    0n,
    0n,
    0n,
    zeroAddress,
    zeroAddress,
    30n,
  ] as const;
  const safeHash = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: safeHashArgs,
  });
  check(safeHash === plan.governance.safeTransactionHash, "SAFE_HASH_CHANGED");
  const signatures = concatHex(
    expectedOwners.map((owner) =>
      concatHex([
        toHex(BigInt(owner), { size: 32 }),
        toHex(0n, { size: 32 }),
        "0x01",
      ]),
    ),
  );
  const execArgs = [
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
  ] as const;
  const transactions = [
    {
      name: "safe-approve-enable-PONS",
      actor: keys[1]!,
      nonce: 336,
      gas: approveGas,
      data: encodeFunctionData({
        abi: safeAbi,
        functionName: "approveHash",
        args: [safeHash],
      }),
    },
    {
      name: "safe-exec-enable-PONS",
      actor: keys[0]!,
      nonce: 830,
      gas: executeGas,
      data: encodeFunctionData({
        abi: safeAbi,
        functionName: "execTransaction",
        args: execArgs,
      }),
    },
  ];
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    check(
      (error as NodeJS.ErrnoException).code === "ENOENT",
      "JOURNAL_UNREADABLE",
    );
    check(
      (await client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "assetEnabled",
        args: [pons],
      })) === false,
      "PONS_ALREADY_ENABLED",
    );
    check(
      (await client.readContract({
        address: safe,
        abi: safeAbi,
        functionName: "nonce",
      })) === 30n,
      "SAFE_NONCE_CHANGED",
    );
    journal = {
      approval:
        "User approved exactly approveHash + execTransaction to enable PONS in mainnet private v2, maximum 0.000007054894972 ETH; no Railway",
      approvedMaxWei: String(cap),
      safeTransactionHash: safeHash,
      transactions: [],
      complete: false,
    };
    await save(journal);
  }
  check(
    journal.approvedMaxWei === String(cap) &&
      journal.safeTransactionHash === safeHash,
    "JOURNAL_SCOPE_CHANGED",
  );
  if (journal.complete) {
    console.log("ALREADY_COMPLETE_NO_BROADCAST");
    return;
  }
  for (let index = 0; index < transactions.length; index++) {
    const tx = transactions[index]!;
    phase = tx.name;
    let entry = journal.transactions.find(
      (candidate) => candidate.name === tx.name,
    );
    if (!entry) {
      check(
        (await client.getTransactionCount({ address: tx.actor.address })) ===
          tx.nonce &&
          (await client.getTransactionCount({
            address: tx.actor.address,
            blockTag: "pending",
          })) === tx.nonce,
        "OWNER_NONCE_CHANGED",
      );
      check(
        (await client.readContract({
          address: safe,
          abi: safeAbi,
          functionName: "nonce",
        })) === 30n,
        "SAFE_NONCE_CHANGED",
      );
      if (index === 1) {
        check(
          (await client.readContract({
            address: safe,
            abi: safeAbi,
            functionName: "approvedHashes",
            args: [expectedOwners[1]!, safeHash],
          })) === 1n,
          "APPROVAL_NOT_RECORDED",
        );
        const simulation = await client.simulateContract({
          address: safe,
          abi: safeAbi,
          functionName: "execTransaction",
          args: execArgs,
          account: tx.actor.address,
        });
        check(simulation.result === true, "SAFE_EXECUTION_SIMULATION_FAILED");
      }
      check(
        (await client.getGasPrice()) <= gasPrice,
        "GAS_PRICE_OVER_APPROVED_LIMIT",
      );
      check(
        (await client.estimateGas({
          account: tx.actor.address,
          to: safe,
          data: tx.data,
          value: 0n,
        })) <= tx.gas,
        "GAS_ESTIMATE_OVER_BUDGET",
      );
      const spent = journal.transactions.reduce(
        (sum, item) => sum + BigInt(item.feeWei ?? "0"),
        0n,
      );
      const reserve = transactions
        .slice(index)
        .reduce((sum, item) => sum + item.gas * gasPrice, 0n);
      check(spent + reserve <= cap, "TOTAL_CAP_EXCEEDED");
      check(
        (await client.getBalance({ address: tx.actor.address })) >=
          tx.gas * gasPrice,
        "OWNER_BALANCE_LOW",
      );
      const raw = await tx.actor.signTransaction({
        chainId: 4663,
        nonce: tx.nonce,
        to: safe,
        data: tx.data,
        value: 0n,
        gas: tx.gas,
        gasPrice,
        type: "legacy",
      });
      entry = { name: tx.name, hash: keccak256(raw), state: "signed" };
      await writeFile(
        path.join(evidence, `pons-${index}.signed-private.json`),
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
    const receipt = await client.waitForTransactionReceipt({
      hash: entry.hash,
      confirmations: 2,
      timeout: 60_000,
      pollingInterval: 1_000,
    });
    const actual = await client.getTransaction({ hash: entry.hash });
    check(
      receipt.status === "success" &&
        actual.from.toLowerCase() === tx.actor.address.toLowerCase() &&
        actual.nonce === tx.nonce &&
        actual.to?.toLowerCase() === safe.toLowerCase() &&
        actual.input === tx.data &&
        actual.value === 0n,
      "RECEIPT_MISMATCH",
    );
    Object.assign(entry, {
      state: "confirmed",
      gasUsed: String(receipt.gasUsed),
      effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      feeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
    });
    await save(journal);
    if (index === 1) {
      const success = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== safe.toLowerCase()) return false;
        try {
          const event = decodeEventLog({
            abi: safeAbi,
            topics: log.topics,
            data: log.data,
          });
          return (
            event.eventName === "ExecutionSuccess" &&
            event.args.txHash === safeHash
          );
        } catch {
          return false;
        }
      });
      check(success, "SAFE_INNER_EXECUTION_FAILED");
    }
    console.log(
      `${index + 1}/2 ${tx.name}: ${entry.hash}; fee ${formatEther(BigInt(entry.feeWei!))} ETH`,
    );
  }
  check(
    (await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "nonce",
    })) === 31n,
    "FINAL_SAFE_NONCE_MISMATCH",
  );
  check(
    (await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "assetEnabled",
      args: [pons],
    })) === true,
    "PONS_NOT_ENABLED",
  );
  journal.totalFeeWei = String(
    journal.transactions.reduce((sum, tx) => sum + BigInt(tx.feeWei!), 0n),
  );
  check(BigInt(journal.totalFeeWei) <= cap, "ACTUAL_FEE_OVER_CAP");
  journal.complete = true;
  await save(journal);
  console.log(
    `COMPLETE 2/2: ${formatEther(BigInt(journal.totalFeeWei))} ETH; PONS enabled; no Railway`,
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
