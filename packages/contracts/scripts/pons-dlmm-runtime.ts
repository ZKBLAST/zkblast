import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  getAddress,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertExecutionBudget,
  validatePonsFundingLimits,
} from "./pons-dlmm-budget.js";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function readJson(file: string) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}
export async function saveJson(file: string, data: unknown) {
  const destination = path.join(root, file);
  await writeFile(
    `${destination}.tmp`,
    JSON.stringify(
      data,
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await rename(`${destination}.tmp`, destination);
}
export async function runtime() {
  check(
    process.env.APP_ENV === "mainnet" && process.env.CHAIN_ID === "4663",
    "Mainnet required",
  );
  const config = await readJson("data/mainnet-pons-dlmm.json");
  validatePonsFundingLimits(config);
  const manifest = await readJson("deployments/mainnet/manifest.json");
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  check(key && /^0x[\da-f]{64}$/iu.test(key), "Invalid deployer key");
  const account = privateKeyToAccount(key as Hex);
  check(
    account.address === getAddress(manifest.deployerAddress),
    "Wrong deployer",
  );
  const rpc = process.env.RPC_URL;
  check(rpc, "RPC required");
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: { default: { http: [rpc] } },
  });
  const client = createPublicClient({ chain, transport: http(rpc) });
  check((await client.getChainId()) === 4663, "Wrong RPC chain");
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const journalPath = "deployments/mainnet/pons-dlmm.private.json";
  const journal = await readJson(journalPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return { chainId: 4663, owner: account.address, steps: {} };
  });
  check(
    journal.chainId === 4663 && journal.owner === account.address,
    "Journal identity mismatch",
  );
  const save = () => saveJson(journalPath, journal);
  async function send(name: string, to: Address, data: Hex, gas: bigint) {
    if (!journal.steps[name]) {
      check(
        process.argv.includes("--broadcast"),
        "Use --broadcast for transactions",
      );
      const maxFee = BigInt(config.maxFeePerGasWei);
      const spent = Object.values(journal.steps).reduce<bigint>(
        (sum, item: any) => sum + BigInt(item.receipt?.totalFeeWei ?? 0),
        0n,
      );
      assertExecutionBudget(
        spent,
        gas,
        maxFee,
        BigInt(config.maxExecutionFeeWei),
      );
      check((await client.getGasPrice()) <= maxFee, "Gas price above cap");
      check(
        (await client.getBalance({ address: account.address })) >= gas * maxFee,
        "Insufficient gas balance",
      );
      await client.call({ account, to, data });
      const estimate = await client.estimateGas({ account, to, data });
      check((estimate * 110n) / 100n <= gas, "Gas estimate exceeds stage cap");
      const hash = await wallet.sendTransaction({
        to,
        data,
        gas,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: 0n,
      });
      journal.steps[name] = { hash };
      await save();
    }
    const receipt = await client.waitForTransactionReceipt({
      hash: journal.steps[name].hash,
    });
    check(
      receipt.status === "success",
      `${name} reverted; do not retry blindly`,
    );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    check(block.hash === receipt.blockHash, "Noncanonical receipt");
    journal.steps[name].receipt = {
      hash: receipt.transactionHash,
      contractAddress: receipt.contractAddress,
      blockNumber: Number(receipt.blockNumber),
      blockHash: receipt.blockHash,
      gasUsed: String(receipt.gasUsed),
      effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      totalFeeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      status: "success",
    };
    await save();
    console.log(
      JSON.stringify({ stage: name, ...journal.steps[name].receipt }),
    );
    return receipt;
  }
  async function contract(
    name: string,
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    gas: bigint,
  ) {
    return send(
      name,
      address,
      encodeFunctionData({ abi, functionName, args }),
      gas,
    );
  }
  return { config, manifest, account, client, journal, save, send, contract };
}
