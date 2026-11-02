import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { anvil } from "viem/chains";

const root = path.resolve(import.meta.dirname, "../../..");
const plan = JSON.parse(await readFile(path.join(root, "deployments/mainnet/launchpad-preset-v1-plan.json"), "utf8")) as {
  chainId: number;
  referenceBlock: string;
  governanceSafe: Address;
  configManager: Address;
  usdg: Address;
  proposedPresetId: string;
  actions: { name: string; target: Address; data: Hex; calldataHash: Hex }[];
  broadcastAllowed: boolean;
};
if (plan.chainId !== 4663 || plan.broadcastAllowed) throw new Error("LAUNCHPAD_PRESET_PLAN_INVALID");
const transport = http(process.env.FORK_RPC_URL ?? "http://127.0.0.1:18546");
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ chain: anvil, mode: "anvil", transport });
if ((await publicClient.getChainId()) !== 4663) throw new Error("LAUNCHPAD_PRESET_FORK_INVALID");
const safe = getAddress(plan.governanceSafe);
await testClient.setBalance({ address: safe, value: 10n ** 18n });
await testClient.impersonateAccount({ address: safe });
const wallet = createWalletClient({ account: safe, transport });
const receipts = [];
let totalGas = 0n;
for (const action of plan.actions) {
  if (keccak256(action.data) !== action.calldataHash) throw new Error(`CALLDATA_DRIFT_${action.name}`);
  const hash = await wallet.sendTransaction({ account: safe, chain: null, to: getAddress(action.target), data: action.data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`PRESET_ACTION_FAILED_${action.name}`);
  totalGas += receipt.gasUsed;
  receipts.push({ name: action.name, hash, gasUsed: receipt.gasUsed.toString() });
}
await testClient.stopImpersonatingAccount({ address: safe });
const configAbi = (JSON.parse(await readFile(path.join(root, "packages/contracts/out/LaunchpadConfigManager.sol/LaunchpadConfigManager.json"), "utf8")) as { abi: any }).abi;
const [allowed, presetCount, preset] = await Promise.all([
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "quoteTokenAllowed", args: [getAddress(plan.usdg)] }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "presetCount" }),
  publicClient.readContract({ address: getAddress(plan.configManager), abi: configAbi, functionName: "preset", args: [BigInt(plan.proposedPresetId)] }),
]);
if (!allowed || presetCount !== 1n || !(preset as any).enabled) throw new Error("LAUNCHPAD_PRESET_STATE_INVALID");
const result = {
  environment: "mainnet-fork",
  sourceBlock: plan.referenceBlock,
  receipts,
  totalGas: totalGas.toString(),
  bufferedGas: ((totalGas * 150n + 99n) / 100n).toString(),
  verified: { quoteTokenAllowed: true, presetId: plan.proposedPresetId, enabled: true },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.join(root, "deployments/mainnet/launchpad-preset-v1-simulation.json"), serialized);
console.log(JSON.stringify({ actions: receipts.length, totalGas: result.totalGas, bufferedGas: result.bufferedGas, sha256: createHash("sha256").update(serialized).digest("hex") }));
