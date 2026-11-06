import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

type Plan = Readonly<{
  planSha256: string;
  chainId: 4663;
  governanceSafe: Address;
  configManager: Address;
  templateId: string;
  proposedPresetId: string;
  quoteAsset: Readonly<{ symbol: "MSFT"; address: Address }>;
  actions: readonly Readonly<{ name: string; target: Address; data: Hex }>[];
}>;

const expectedPlanHash =
  "446ef053d4e02a204d43099240a97ea9fb74833bb4244a9c137bfade1bc2b7a4";
const cap = parseEther("0.00006");
const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(
  await readFile(
    path.join(root, "deployments/mainnet/launchpad-msft-dlmm-preset-plan.json"),
    "utf8",
  ),
) as Plan;
assert.equal(plan.planSha256, expectedPlanHash, "PRESET_PLAN_HASH_MISMATCH");
assert.equal(plan.chainId, 4663, "PRESET_CHAIN_MISMATCH");
assert.equal(plan.templateId, "8", "PRESET_TEMPLATE_MISMATCH");
assert.equal(plan.proposedPresetId, "2", "PRESET_ID_MISMATCH");
assert.equal(plan.actions.length, 3, "PRESET_ACTION_COUNT_MISMATCH");

const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
assert(key && /^0x[\da-f]{64}$/iu.test(key), "DEPLOYER_PRIVATE_KEY_INVALID");
const deployer = privateKeyToAccount(key as Hex);
const rpcCandidates = [
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim()),
  "https://robinhood.drpc.org",
  "https://robinhood-rpc.publicnode.com",
].filter((value): value is string => Boolean(value));
let rpcUrl = "";
for (const candidate of new Set(rpcCandidates)) {
  const probe = createPublicClient({
    transport: http(candidate, { retryCount: 0, timeout: 12_000 }),
  });
  try {
    if ((await probe.getChainId()) === plan.chainId) {
      rpcUrl = candidate;
      break;
    }
  } catch {
    // Continue with the next configured/public RPC.
  }
}
assert(rpcUrl, "NO_HEALTHY_MAINNET_RPC");
const chain = defineChain({
  id: plan.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const transport = http(rpcUrl, { retryCount: 1, timeout: 20_000 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: deployer, chain, transport });
const configAbi = parseAbi([
  "function presetCount() view returns(uint256)",
  "function quoteTokenAllowed(address) view returns(bool)",
  "function destinationSupported(uint8) view returns(bool)",
  "function preset(uint256) view returns(bytes32 familyId,bytes32 configHash,uint256 dbcTemplateId,address quoteToken,uint16 maximumTotalTradeFeeBps,uint8 graduationDestination,uint8 creatorAccess,uint32 maximumLaunches,uint32 version,bool enabled,bool used)",
]);
const beforeCount = await client.readContract({
  address: plan.configManager,
  abi: configAbi,
  functionName: "presetCount",
});
assert(beforeCount <= BigInt(plan.proposedPresetId), "PRESET_COUNT_DRIFT");

const receipts: TransactionReceipt[] = [];
for (const action of plan.actions) {
  if (
    action.name === "allow-msft-quote-token" &&
    (await client.readContract({
      address: plan.configManager,
      abi: configAbi,
      functionName: "quoteTokenAllowed",
      args: [plan.quoteAsset.address],
    }))
  )
    continue;
  if (
    action.name === "enable-dlmm-launchpad-destination" &&
    (await client.readContract({
      address: plan.configManager,
      abi: configAbi,
      functionName: "destinationSupported",
      args: [2],
    }))
  )
    continue;
  if (
    action.name === "create-msft-dlmm-launchpad-preset" &&
    (await client.readContract({
      address: plan.configManager,
      abi: configAbi,
      functionName: "presetCount",
    })) >= BigInt(plan.proposedPresetId)
  )
    continue;
  const prepared = await prepareSafeOperation(client, {
    chainId: plan.chainId,
    safe: getAddress(plan.governanceSafe),
    to: getAddress(action.target),
    data: action.data,
    relayer: deployer,
  });
  const estimatedGas = await client.estimateGas({
    account: deployer,
    to: prepared.to,
    data: prepared.data,
  });
  const gasPrice = await client.getGasPrice();
  const incurred = receipts.reduce(
    (sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice,
    0n,
  );
  assert(
    incurred + estimatedGas * gasPrice <= cap,
    `PRESET_FEE_CAP_PREFLIGHT_EXCEEDED:${action.name}`,
  );
  const hash = await wallet.sendTransaction({
    account: deployer,
    to: prepared.to,
    data: prepared.data,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(
    receipt.status,
    "success",
    `PRESET_ACTION_FAILED:${action.name}`,
  );
  receipts.push(receipt);
}

const presetId = BigInt(plan.proposedPresetId);
const [presetCount, quoteAllowed, dlmmSupported, preset] = await Promise.all([
  client.readContract({
    address: plan.configManager,
    abi: configAbi,
    functionName: "presetCount",
  }),
  client.readContract({
    address: plan.configManager,
    abi: configAbi,
    functionName: "quoteTokenAllowed",
    args: [plan.quoteAsset.address],
  }),
  client.readContract({
    address: plan.configManager,
    abi: configAbi,
    functionName: "destinationSupported",
    args: [2],
  }),
  client.readContract({
    address: plan.configManager,
    abi: configAbi,
    functionName: "preset",
    args: [presetId],
  }),
]);
assert.equal(presetCount, presetId, "PRESET_COUNT_NOT_UPDATED");
assert.equal(quoteAllowed, true, "MSFT_QUOTE_NOT_ALLOWED");
assert.equal(dlmmSupported, true, "DLMM_DESTINATION_NOT_ENABLED");
const presetTuple = preset as readonly unknown[];
assert.equal(
  BigInt(String(presetTuple[2])),
  8n,
  "CREATED_PRESET_TEMPLATE_MISMATCH",
);
assert.equal(
  getAddress(String(presetTuple[3])),
  getAddress(plan.quoteAsset.address),
  "CREATED_PRESET_QUOTE_MISMATCH",
);
assert.equal(Number(presetTuple[5]), 2, "CREATED_PRESET_DESTINATION_MISMATCH");
assert.equal(Boolean(presetTuple[9]), true, "CREATED_PRESET_NOT_ENABLED");
const totalFee = receipts.reduce(
  (sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice,
  0n,
);
assert(totalFee <= cap, "PRESET_FEE_CAP_EXCEEDED");
const output = {
  schemaVersion: 1,
  planSha256: plan.planSha256,
  presetId: plan.proposedPresetId,
  templateId: plan.templateId,
  quoteAsset: plan.quoteAsset,
  destination: "DLMM",
  totalFeeWei: totalFee.toString(),
  totalFeeEth: formatEther(totalFee),
  capEth: formatEther(cap),
  transactions: receipts.map((receipt) => receipt.transactionHash),
  assertions: {
    msftQuoteAllowed: true,
    dlmmDestinationEnabled: true,
    presetEnabled: true,
  },
};
await writeFile(
  path.join(
    root,
    "deployments/mainnet/launchpad-msft-dlmm-preset-broadcast.json",
  ),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output));
