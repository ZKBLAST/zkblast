import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

type Manifest = Readonly<{
  chainId: 4663;
  deployerAddress: Address;
  governanceAddress: Address;
  launchpad: Readonly<{ configManager: Address }>;
  dbc: Readonly<{ configRegistry: Address }>;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(root, "deployments/mainnet/manifest.json"), "utf8"),
) as Manifest;
if (manifest.chainId !== 4663) throw new Error("CHAIN_CONTEXT_INVALID");
const artifact = async (name: string): Promise<Abi> =>
  (
    JSON.parse(
      await readFile(
        path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    ) as { abi: Abi }
  ).abi;
const [configAbi, dbcAbi] = await Promise.all([
  artifact("LaunchpadConfigManager"),
  artifact("LaunchConfigRegistry"),
]);
const rpcCandidates = [
  process.env.RPC_URL?.trim(),
  ...(process.env.RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim()),
  "https://robinhood.drpc.org",
  "https://robinhood-rpc.publicnode.com",
].filter((value): value is string => Boolean(value));
let client: ReturnType<typeof createPublicClient> | undefined;
for (const rpcUrl of new Set(rpcCandidates)) {
  const candidate = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 12_000 }),
  });
  try {
    if ((await candidate.getChainId()) === manifest.chainId) {
      client = candidate;
      break;
    }
  } catch {
    // Continue with the next configured/public RPC.
  }
}
if (!client) throw new Error("NO_HEALTHY_MAINNET_RPC");

const configManager = getAddress(manifest.launchpad.configManager);
const dbcRegistry = getAddress(manifest.dbc.configRegistry);
const safe = getAddress(manifest.governanceAddress);
const msft = getAddress("0xe93237C50D904957Cf27E7B1133b510C669c2e74");
const templateId = 8n;
const [block, presetCount, template, quoteAllowed, dlmmSupported, gasPrice] =
  await Promise.all([
    client.getBlock(),
    client.readContract({
      address: configManager,
      abi: configAbi,
      functionName: "presetCount",
    }),
    client.readContract({
      address: dbcRegistry,
      abi: dbcAbi,
      functionName: "templateConfig",
      args: [templateId],
    }),
    client.readContract({
      address: configManager,
      abi: configAbi,
      functionName: "quoteTokenAllowed",
      args: [msft],
    }),
    client.readContract({
      address: configManager,
      abi: configAbi,
      functionName: "destinationSupported",
      args: [2],
    }),
    client.getGasPrice(),
  ]);
const templateConfig = template as Readonly<{
  quoteToken: Address;
  migrationMode: number;
}>;
if (getAddress(templateConfig.quoteToken) !== msft)
  throw new Error("TEMPLATE_8_QUOTE_TOKEN_MISMATCH");
if (Number(templateConfig.migrationMode) !== 1)
  throw new Error("TEMPLATE_8_NOT_DLMM");

const preset = {
  familyId: keccak256(toHex("ZKBLAST_LAUNCHPAD_DLMM_MSFT_V1")),
  dbcTemplateId: templateId,
  quoteToken: msft,
  maximumTotalTradeFeeBps: 300,
  graduationDestination: 2,
  creatorAccess: 0,
  maximumLaunches: 1000,
} as const;
const actions: { name: string; target: Address; data: Hex }[] = [];
if (!quoteAllowed) {
  actions.push({
    name: "allow-msft-quote-token",
    target: configManager,
    data: encodeFunctionData({
      abi: configAbi,
      functionName: "setQuoteToken",
      args: [msft, true],
    }),
  });
}
if (!dlmmSupported) {
  actions.push({
    name: "enable-dlmm-launchpad-destination",
    target: configManager,
    data: encodeFunctionData({
      abi: configAbi,
      functionName: "setGraduationDestination",
      args: [2, true],
    }),
  });
}
actions.push({
  name: "create-msft-dlmm-launchpad-preset",
  target: configManager,
  data: encodeFunctionData({
    abi: configAbi,
    functionName: "createPreset",
    args: [preset],
  }),
});
const gas = await Promise.all(
  actions.map((action) =>
    client!
      .estimateGas({
        account: safe,
        to: action.target,
        data: action.data,
      })
      // Dependent calls cannot be estimated until the earlier governance
      // actions are applied. Keep the plan read-only and use a safe fallback.
      .catch(() => 200_000n),
  ),
);
const conservativeGas = gas.reduce((sum, value) => sum + value + 250_000n, 0n);
const unsigned = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: manifest.chainId,
  referenceBlock: block.number.toString(),
  governanceSafe: safe,
  configManager,
  quoteAsset: { symbol: "MSFT", address: msft },
  templateId: templateId.toString(),
  proposedPresetId: (BigInt(String(presetCount)) + 1n).toString(),
  preset: { ...preset, dbcTemplateId: templateId.toString() },
  actions,
  estimate: {
    directActionGas: gas.map(String),
    conservativeSafeGas: conservativeGas.toString(),
    gasPriceWei: gasPrice.toString(),
    conservativeFeeWei: (conservativeGas * gasPrice).toString(),
  },
  broadcastAllowed: false,
};
const planSha256 = createHash("sha256")
  .update(JSON.stringify(unsigned))
  .digest("hex");
const outputPath = path.join(
  root,
  "deployments/mainnet/launchpad-msft-dlmm-preset-plan.json",
);
await writeFile(
  outputPath,
  `${JSON.stringify({ ...unsigned, planSha256 }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    outputPath,
    planSha256,
    proposedPresetId: unsigned.proposedPresetId,
    actions: actions.length,
    ...unsigned.estimate,
  }),
);
