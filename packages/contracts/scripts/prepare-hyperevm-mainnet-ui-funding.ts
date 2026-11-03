import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const presetPlanBytes = await readFile(
  path.join(directory, "launchpad-preset-v1-plan.json"),
);
const presetPlan = JSON.parse(presetPlanBytes.toString("utf8")) as {
  governance: `0x${string}`;
  quoteToken: `0x${string}`;
  startingNonce: number;
  nextNonce: number;
};
assert.equal(presetPlan.startingNonce, 57);
assert.equal(presetPlan.nextNonce, 59);
const owner = getAddress(presetPlan.governance);
const quoteToken = getAddress(presetPlan.quoteToken);
const amount = parseEther("0.001");
const abi = parseAbi([
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
]);
const client = createPublicClient({
  transport: http(
    process.env.HYPEREVM_MAINNET_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm",
    { timeout: 20_000, retryCount: 1 },
  ),
});
assert.equal(await client.getChainId(), 999);
const data = encodeFunctionData({ abi, functionName: "deposit" });
const [nonce, nativeBalance, quoteBalance, gasPrice, gasEstimate, block] =
  await Promise.all([
    client.getTransactionCount({ address: owner, blockTag: "pending" }),
    client.getBalance({ address: owner }),
    client.readContract({ address: quoteToken, abi, functionName: "balanceOf", args: [owner] }),
    client.getGasPrice(),
    client.estimateGas({ account: owner, to: quoteToken, data, value: amount }),
    client.getBlock(),
  ]);
assert.equal(nonce, 57, "HYPEREVM_UI_FUNDING_NONCE_DRIFT");
assert.equal(quoteBalance, 0n, "HYPEREVM_UI_FUNDING_ALREADY_PRESENT");
const guardedGas = (gasEstimate * 150n) / 100n;
const maximumGasFeeWei = guardedGas * gasPrice;
assert(nativeBalance > amount + maximumGasFeeWei, "HYPEREVM_UI_FUNDING_BALANCE_LOW");
const plan = {
  schemaVersion: 1,
  chainId: 999,
  environment: "mainnet",
  generatedAt: new Date().toISOString(),
  referenceBlock: block.number.toString(),
  owner,
  target: quoteToken,
  action: "wrap-native-hype-for-ui-acceptance",
  nonce: 59,
  prerequisitePresetPlanSha256: createHash("sha256")
    .update(presetPlanBytes)
    .digest("hex"),
  valueWei: amount.toString(),
  valueHype: formatEther(amount),
  data,
  gasEstimate: gasEstimate.toString(),
  guardedGas: guardedGas.toString(),
  gasPriceWei: gasPrice.toString(),
  maximumGasFeeWei: maximumGasFeeWei.toString(),
  maximumGasFeeHype: formatEther(maximumGasFeeWei),
  safety: {
    exactValueHype: "0.001",
    maximumGasFeeHype: "0.00001",
    destinationIsTemplateQuoteToken: true,
    broadcastAllowed: false,
    explicitApprovalRequired: true,
  },
};
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
const output = path.join(directory, "launchpad-ui-funding-plan.json");
await writeFile(output, serialized, { mode: 0o644 });
console.log(
  JSON.stringify(
    {
      chainId: 999,
      owner,
      target: quoteToken,
      nonce: plan.nonce,
      valueHype: plan.valueHype,
      gasEstimate: plan.gasEstimate,
      guardedGas: plan.guardedGas,
      maximumGasFeeHype: plan.maximumGasFeeHype,
      planSha256: createHash("sha256").update(serialized).digest("hex"),
      broadcastAllowed: false,
      output,
    },
    null,
    2,
  ),
);
