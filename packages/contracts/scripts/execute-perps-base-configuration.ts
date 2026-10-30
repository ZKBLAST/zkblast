import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http,
  parseAbi, parseEther, type Abi, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareSafeOperation } from "./safe-operation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const capArg = process.argv.find((value) => value.startsWith("--cap-eth="))?.split("=")[1];
assert(capArg, "--cap-eth is required");
const cap = parseEther(capArg);
assert.equal(cap, parseEther(environment === "testnet" ? "0.000002" : "0.000025"), "Unapproved fee cap");
const key = (name: string) => {
  const value = process.env[name];
  assert(value && /^0x[0-9a-f]{64}$/iu.test(value), `${name} is invalid`);
  return value as Hex;
};
const manifest = JSON.parse(await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8")) as any;
const plan = JSON.parse(await readFile(path.join(root, `deployments/${environment}/perps-base-configuration-plan.json`), "utf8")) as any;
assert.equal(plan.chainId, manifest.chainId, "Configuration plan chain mismatch");
assert(BigInt(plan.gas.feeCeilingWei) <= cap, "Planned fee exceeds approved cap");
const artifact = async (file: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${file}.sol/${file}.json`), "utf8")) as { abi: Abi }).abi;
const [privateVaultAbi, vaultAbi, engineAbi] = await Promise.all([
  artifact("PrivateVaultV2"), artifact("LiquidityVaultUSDG"), artifact("PerpEngine"),
]);
const chain = defineChain({
  id: manifest.chainId, name: environment === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const transport = http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 });
const publicClient = createPublicClient({ chain, transport });
assert.equal(await publicClient.getChainId(), manifest.chainId, "RPC chain mismatch");
const custody = getAddress(manifest.shieldedV2.vault);
const collateral = getAddress(manifest.perps.collateral);
const vault = getAddress(manifest.perps.liquidityVault);
const adapter = getAddress(manifest.perps.shieldedAdapter);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const snapshot = async () => {
  const [rootHash, leafIndex, liability, custodyBalance] = await Promise.all([
    publicClient.readContract({ address: custody, abi: privateVaultAbi, functionName: "currentRoot" }),
    publicClient.readContract({ address: custody, abi: privateVaultAbi, functionName: "nextLeafIndex" }),
    publicClient.readContract({ address: custody, abi: privateVaultAbi, functionName: "liabilityRaw", args: [collateral] }),
    publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [custody] }),
  ]);
  return { rootHash, leafIndex, liability, custodyBalance };
};
const before = await snapshot();
const receipts: TransactionReceipt[] = [];
if (environment === "testnet") {
  const governance = privateKeyToAccount(key("GOVERNANCE_PRIVATE_KEY"));
  assert.equal(governance.address, getAddress(plan.governance), "Governance key does not match plan");
  const wallet = createWalletClient({ account: governance, chain, transport });
  for (const action of plan.actions) {
    const hash = await wallet.sendTransaction({ account: governance, to: action.target, data: action.data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", `${action.name} failed`);
    receipts.push(receipt);
  }
} else {
  const relayer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
  const wallet = createWalletClient({ account: relayer, chain, transport });
  for (const action of plan.actions) {
    const operation = await prepareSafeOperation(publicClient, {
      chainId: manifest.chainId, safe: getAddress(plan.governance), to: action.target,
      data: action.data, relayer,
    });
    const hash = await wallet.sendTransaction({ account: relayer, to: operation.to, data: operation.data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", `${action.name} failed`);
    receipts.push(receipt);
  }
}
const after = await snapshot();
assert.deepEqual(after, before, "Private note/root/liability/balance state changed during base configuration");
const [openingsPaused, adapterAuthorized, depositsPaused, positionsPaused] = await Promise.all([
  publicClient.readContract({ address: manifest.perps.engine, abi: engineAbi, functionName: "openingsPaused" }),
  publicClient.readContract({ address: custody, abi: privateVaultAbi, functionName: "perpsAdapterAuthorized", args: [adapter] }),
  publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "depositsPaused" }),
  publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "positionsPaused" }),
]);
assert(openingsPaused && adapterAuthorized && depositsPaused && positionsPaused, "Post-configuration safety state mismatch");
const totalFee = receipts.reduce((sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
assert(totalFee <= cap, "Actual base-configuration fee exceeded approved cap");
console.log(JSON.stringify({
  environment, transactions: receipts.map((receipt) => receipt.transactionHash),
  totalFeeWei: totalFee.toString(), totalFeeEth: formatEther(totalFee), capEth: formatEther(cap),
  openingsPaused, adapterAuthorized, noteStateUnchanged: true,
}));
