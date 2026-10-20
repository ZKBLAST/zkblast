import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  padHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";
import { parseDeploymentManifest } from "../../config/src/deployment.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
type Stage = "deploy" | "schedule" | "execute";
type Plan = {
  planHash: Hex;
  chainId: number;
  deployer: Address;
  deployerNonce: number;
  proxy: Address;
  previousImplementation: Address;
  newImplementation: Address;
  safe: Address;
  timelock: Address;
  delaySeconds: number;
  creationCodeHash: Hex;
  operationId: Hex;
  scheduleCalldata: Hex;
  executeCalldata: Hex;
  gasLimits: Record<Stage, string>;
  maxFeePerGasWei: string;
};
type ReceiptRecord = {
  hash: Hex;
  contractAddress: Address | null;
  blockNumber: number;
  blockHash: Hex;
  gasUsed: string;
  effectiveGasPriceWei: string;
  totalFeeWei: string;
  status: "success";
};
type Journal = {
  planHash: Hex;
  steps: Partial<
    Record<
      Stage,
      { hash: Hex; safeTransactionHash?: Hex; receipt?: ReceiptRecord }
    >
  >;
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(receipt: TransactionReceipt): ReceiptRecord {
  return {
    hash: receipt.transactionHash,
    contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    totalFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: "success",
  };
}
async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(`${file}.tmp`, file);
}

async function main() {
  const stage = process.argv[2];
  check(
    stage === "deploy" || stage === "schedule" || stage === "execute",
    "Specify deploy, schedule, or execute",
  );
  check(
    process.env.APP_ENV === "mainnet" && process.env.CHAIN_ID === "4663",
    "Mainnet configuration required",
  );
  const planFile = path.join(
    root,
    "deployments/mainnet/dlmm-upgrade-plan.json",
  );
  const parsed = JSON.parse(await readFile(planFile, "utf8")) as Plan;
  const { planHash, ...body } = parsed;
  check(
    keccak256(toHex(JSON.stringify(body))) === planHash,
    "Plan hash invalid",
  );
  check(
    process.env.CONFIRM_DLMM_UPGRADE_PLAN_HASH === planHash,
    "Exact reviewed plan hash must be confirmed",
  );
  const artifact = JSON.parse(
    await readFile(
      path.join(
        root,
        "packages/contracts/out/PoolFactory.sol/PoolFactory.json",
      ),
      "utf8",
    ),
  ) as {
    abi: Abi;
    bytecode: { object: Hex };
    deployedBytecode: {
      object: Hex;
      immutableReferences: Record<string, { start: number; length: number }[]>;
    };
  };
  check(
    keccak256(artifact.bytecode.object) === parsed.creationCodeHash,
    "Artifact changed since plan",
  );
  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  check(
    key && /^0x[\da-f]{64}$/iu.test(key),
    "Deployer key missing or invalid",
  );
  const account = privateKeyToAccount(key as Hex);
  check(account.address === getAddress(parsed.deployer), "Deployer mismatch");
  check(parsed.chainId === 4663, "Plan chain mismatch");
  const rpc = process.env.RPC_URL;
  check(rpc, "RPC_URL required");
  const forkOnly = process.argv.includes("--fork");
  const localhost = ["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(rpc).hostname,
  );
  check(
    forkOnly === localhost,
    "Local rehearsal requires --fork; live mode requires a remote RPC",
  );
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  check((await client.getChainId()) === 4663, "RPC chain mismatch");
  const journalFile = path.join(
    root,
    forkOnly
      ? "docs/evidence/mainnet/dlmm-executor.private.json"
      : "deployments/mainnet/dlmm-upgrade.private.json",
  );
  const journal = await readFile(journalFile, "utf8")
    .then((value) => JSON.parse(value) as Journal)
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { planHash, steps: {} } as Journal;
    });
  check(
    journal.planHash === planHash,
    "Existing journal belongs to another plan",
  );
  const timelockAbi = parseAbi([
    "function getMinDelay() view returns (uint256)",
    "function getTimestamp(bytes32 id) view returns (uint256)",
    "function isOperationDone(bytes32 id) view returns (bool)",
  ]);
  check(
    (await client.readContract({
      address: parsed.timelock,
      abi: timelockAbi,
      functionName: "getMinDelay",
    })) === 300n,
    "Timelock delay changed",
  );
  const currentSlot = await client.getStorageAt({
    address: parsed.proxy,
    slot,
  });
  const current = getAddress(`0x${currentSlot?.slice(-40)}`);
  check(
    current === getAddress(parsed.previousImplementation) ||
      current === getAddress(parsed.newImplementation),
    "Proxy implementation drift",
  );

  const finish = async (hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    check(
      receipt.status === "success",
      "Transaction reverted; inspect journal",
    );
    journal.steps[stage] = {
      ...journal.steps[stage],
      hash,
      receipt: record(receipt),
    };
    await save(journalFile, journal);
    return receipt;
  };
  let receipt: TransactionReceipt;
  if (journal.steps[stage]) {
    receipt = await finish(journal.steps[stage]!.hash);
  } else {
    const gas = BigInt(parsed.gasLimits[stage]);
    const maxFeePerGas = BigInt(parsed.maxFeePerGasWei);
    check(
      (await client.getBalance({ address: account.address })) >=
        gas * maxFeePerGas,
      "Insufficient fee reservation",
    );
    check(
      (await client.getGasPrice()) <= maxFeePerGas,
      "Gas exceeds reviewed fee cap",
    );
    if (stage === "deploy") {
      check(
        current === getAddress(parsed.previousImplementation),
        "Upgrade already executed",
      );
      const nonce = await client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      check(
        nonce === parsed.deployerNonce,
        "Deployer nonce changed; regenerate plan before approval",
      );
      check(
        getContractAddress({ from: account.address, nonce: BigInt(nonce) }) ===
          getAddress(parsed.newImplementation),
        "Predicted implementation mismatch",
      );
      const hash = await wallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        nonce,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas: 0n,
      });
      journal.steps.deploy = { hash };
      await save(journalFile, journal);
      receipt = await finish(hash);
    } else {
      check(
        journal.steps.deploy?.receipt,
        "Implementation deployment must complete first",
      );
      const code = await client.getBytecode({
        address: parsed.newImplementation,
      });
      let expected = artifact.deployedBytecode.object;
      for (const references of Object.values(
        artifact.deployedBytecode.immutableReferences,
      )) {
        for (const reference of references) {
          check(reference.length === 32, "Unexpected immutable layout");
          const offset = 2 + reference.start * 2;
          expected =
            `${expected.slice(0, offset)}${padHex(parsed.newImplementation, { size: 32 }).slice(2)}${expected.slice(offset + 64)}` as Hex;
        }
      }
      check(
        code && keccak256(code) === keccak256(expected),
        "Deployed implementation bytecode mismatch",
      );
      if (stage === "execute") {
        check(journal.steps.schedule?.receipt, "Schedule must complete first");
        const timestamp = await client.readContract({
          address: parsed.timelock,
          abi: timelockAbi,
          functionName: "getTimestamp",
          args: [parsed.operationId],
        });
        const block = await client.getBlock();
        check(
          timestamp > 1n && block.timestamp >= timestamp,
          `Timelock not ready until ${timestamp}`,
        );
      }
      const prepared = await prepareSafeOperation(client, {
        chainId: 4663,
        safe: parsed.safe,
        to: parsed.timelock,
        data:
          stage === "schedule"
            ? parsed.scheduleCalldata
            : parsed.executeCalldata,
        relayer: account,
      });
      const hash = await wallet.sendTransaction({
        to: prepared.to,
        data: prepared.data,
        gas,
        maxFeePerGas,
        maxPriorityFeePerGas: 0n,
      });
      journal.steps[stage] = { hash, safeTransactionHash: prepared.hash };
      await save(journalFile, journal);
      receipt = await finish(hash);
    }
  }
  if (stage === "schedule") {
    const timestamp = await client.readContract({
      address: parsed.timelock,
      abi: timelockAbi,
      functionName: "getTimestamp",
      args: [parsed.operationId],
    });
    check(
      timestamp > 1n,
      "Safe transaction did not schedule the timelock operation",
    );
  }
  if (stage === "execute") {
    const stored = await client.getStorageAt({ address: parsed.proxy, slot });
    check(
      getAddress(`0x${stored?.slice(-40)}`) ===
        getAddress(parsed.newImplementation),
      "Upgrade slot did not change",
    );
    check(
      await client.readContract({
        address: parsed.timelock,
        abi: timelockAbi,
        functionName: "isOperationDone",
        args: [parsed.operationId],
      }),
      "Timelock operation not complete",
    );
    const manifestFile = path.join(root, "deployments/mainnet/manifest.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      generatedAt: string;
      totals: {
        transactionCount: number;
        gasUsed: string;
        totalFeeWei: string;
      };
      contracts: {
        PoolFactory: {
          implementationAddress: Address;
          deployedRuntimeBytecodeHash: Hex;
          artifactBytecodeHash: Hex;
          upgrades?: unknown[];
          verification: unknown;
        };
      };
    };
    const target = manifest.contracts.PoolFactory;
    if (
      getAddress(target.implementationAddress) !==
      getAddress(parsed.newImplementation)
    ) {
      target.upgrades ??= [];
      target.upgrades.push({
        planHash,
        previousImplementationAddress: parsed.previousImplementation,
        newImplementationAddress: parsed.newImplementation,
        implementationDeployment: journal.steps.deploy?.receipt,
        proxyUpgrade: journal.steps.execute?.receipt,
        receipts: journal.steps,
      });
      target.implementationAddress = parsed.newImplementation;
      target.artifactBytecodeHash = keccak256(artifact.deployedBytecode.object);
      target.deployedRuntimeBytecodeHash = keccak256(
        (await client.getBytecode({ address: parsed.newImplementation }))!,
      );
      target.verification = {
        implementation: "pending",
        proxy: "pending",
        urls: [],
      };
      const records = Object.values(journal.steps).map((step) => step.receipt);
      check(
        records.length === 3 && records.every(Boolean),
        "Upgrade receipt ledger incomplete",
      );
      manifest.totals.transactionCount += records.length;
      manifest.totals.gasUsed = (
        BigInt(manifest.totals.gasUsed) +
        records.reduce((sum, item) => sum + BigInt(item!.gasUsed), 0n)
      ).toString();
      manifest.totals.totalFeeWei = (
        BigInt(manifest.totals.totalFeeWei) +
        records.reduce((sum, item) => sum + BigInt(item!.totalFeeWei), 0n)
      ).toString();
      manifest.generatedAt = new Date().toISOString();
      parseDeploymentManifest(manifest, { environment: "mainnet", chainId: 4663 });
      if (!forkOnly) await save(manifestFile, manifest);
    }
  }
  console.log(
    JSON.stringify({ stage, planHash, receipt: record(receipt) }, null, 2),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message.split("\n")[0]
      : "DLMM upgrade failed",
  );
  process.exitCode = 1;
});
