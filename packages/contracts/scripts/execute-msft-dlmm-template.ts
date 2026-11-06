import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const planPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/msft-dlmm-template-plan.json",
);
const journalPath = path.join(
  root,
  "deployments/mainnet/stock-quotes/msft-dlmm-template-execution.private.json",
);
const plan = JSON.parse(await readFile(planPath, "utf8")) as unknown as {
  environment: string;
  chainId: number;
  planSha256: string;
  governance: Address;
  registry: Address;
  asset: Address;
  proposedTemplateId: string;
  action: { name: string; target: Address; data: Hex };
  gates: { broadcastAllowed: false; requiresExplicitApproval: true };
};
const unsigned = { ...plan } as Record<string, unknown>;
delete unsigned.planSha256;
assert.equal(
  createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  plan.planSha256,
  "PLAN_HASH_DRIFT",
);
assert.equal(process.env.APP_ENV, "mainnet", "APP_ENV_MAINNET_REQUIRED");
assert.equal(plan.environment, "mainnet");
assert.equal(plan.chainId, 4663);
assert.equal(plan.proposedTemplateId, "8");
assert.equal(plan.gates.broadcastAllowed, false);

const confirmedPlan = process.argv
  .find((value) => value.startsWith("--confirm-plan="))
  ?.split("=")[1];
const capArgument = process.argv
  .find((value) => value.startsWith("--cap-eth="))
  ?.split("=")[1];
assert.equal(
  confirmedPlan,
  plan.planSha256,
  "EXACT_PLAN_CONFIRMATION_REQUIRED",
);
assert.equal(capArgument, "0.00003", "UNAPPROVED_FEE_CAP");
const feeCap = parseEther(capArgument);

const rpcUrl =
  process.env.STOCK_QUOTE_RPC_URL?.trim() ||
  process.env.ROBINHOOD_PUBLIC_RPC_URL?.trim() ||
  process.env.RPC_URL?.trim();
assert(rpcUrl, "RPC_URL_REQUIRED");
const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(
  privateKey && /^0x[\da-f]{64}$/iu.test(privateKey),
  "INVALID_DEPLOYER_KEY",
);
const relayer = privateKeyToAccount(privateKey as Hex);
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }),
});
const wallet = createWalletClient({
  account: relayer,
  chain,
  transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }),
});
assert.equal(await client.getChainId(), 4663);

let journal:
  | {
      planSha256: string;
      transactionHash: Hex;
      totalFeeWei?: string;
    }
  | undefined;
try {
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  journal = parsed as typeof journal;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (journal)
  assert.equal(journal.planSha256, plan.planSha256, "EXECUTION_PLAN_MISMATCH");

let transactionHash = journal?.transactionHash;
if (!transactionHash) {
  const operation = await prepareSafeOperation(client, {
    chainId: 4663,
    safe: getAddress(plan.governance),
    to: getAddress(plan.action.target),
    data: plan.action.data,
    relayer,
  });
  const request = await wallet.prepareTransactionRequest({
    account: relayer,
    to: operation.to,
    data: operation.data,
  });
  assert(
    request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) <= feeCap,
    "FEE_CAP_EXCEEDED",
  );
  const serialized = await relayer.signTransaction(request);
  transactionHash = keccak256(serialized);
  await writeFile(
    journalPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        environment: "mainnet",
        chainId: 4663,
        planSha256: plan.planSha256,
        status: "signed",
        transactionHash,
        capWei: feeCap.toString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  try {
    await client.request({
      method: "eth_sendRawTransaction",
      params: [serialized],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already known")) throw error;
  }
}

const receipt = await client.waitForTransactionReceipt({
  hash: transactionHash,
  confirmations: 1,
});
assert.equal(receipt.status, "success", "TEMPLATE_TRANSACTION_REVERTED");
const totalFeeWei = receipt.gasUsed * receipt.effectiveGasPrice;
assert(totalFeeWei <= feeCap, "ACTUAL_FEE_CAP_EXCEEDED");

const registryAbi = [
  {
    type: "function",
    name: "templateConfig",
    stateMutability: "view",
    inputs: [{ name: "templateId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "quoteToken", type: "address" },
          { name: "protocolFeeRecipient", type: "address" },
          { name: "partnerFeeRecipient", type: "address" },
          { name: "protocolLpRecipient", type: "address" },
          { name: "quoteDecimals", type: "uint8" },
          { name: "baseDecimals", type: "uint8" },
          { name: "migrationMode", type: "uint8" },
          { name: "destinationFeePips", type: "uint24" },
          { name: "terminalPriceToleranceBps", type: "uint16" },
          { name: "totalSupplyRaw", type: "uint128" },
          { name: "baseInventoryRaw", type: "uint128" },
          { name: "graduationThresholdRaw", type: "uint128" },
          { name: "minimumDestinationShares", type: "uint128" },
          {
            name: "curve",
            type: "tuple",
            components: [
              { name: "segmentCount", type: "uint8" },
              {
                name: "segments",
                type: "tuple[16]",
                components: [
                  { name: "initialPriceX18", type: "uint128" },
                  { name: "slopeX18", type: "uint128" },
                  { name: "saleCapacityX18", type: "uint128" },
                ],
              },
            ],
          },
          {
            name: "fees",
            type: "tuple",
            components: [
              { name: "tradeFeeBps", type: "uint16" },
              { name: "creatorShareBps", type: "uint16" },
              { name: "partnerShareBps", type: "uint16" },
              { name: "protocolShareBps", type: "uint16" },
            ],
          },
          {
            name: "lp",
            type: "tuple",
            components: [
              { name: "creatorShareBps", type: "uint16" },
              { name: "protocolShareBps", type: "uint16" },
              { name: "creatorLockSeconds", type: "uint32" },
            ],
          },
        ],
      },
    ],
  },
] as const;
const created = await client.readContract({
  address: getAddress(plan.registry),
  abi: registryAbi,
  functionName: "templateConfig",
  args: [BigInt(plan.proposedTemplateId)],
});
assert.equal(getAddress(created.quoteToken), getAddress(plan.asset));
assert.equal(created.migrationMode, 1, "CREATED_TEMPLATE_NOT_DLMM");
await writeFile(
  journalPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      environment: "mainnet",
      chainId: 4663,
      planSha256: plan.planSha256,
      status: "confirmed",
      transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
      totalFeeWei: totalFeeWei.toString(),
      totalFeeEth: formatEther(totalFeeWei),
      capEth: formatEther(feeCap),
      templateId: plan.proposedTemplateId,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({
    status: "confirmed",
    planSha256: plan.planSha256,
    transactionHash,
    templateId: plan.proposedTemplateId,
    migrationMode: "dlmm",
    totalFeeEth: formatEther(totalFeeWei),
    capEth: formatEther(feeCap),
  }),
);
