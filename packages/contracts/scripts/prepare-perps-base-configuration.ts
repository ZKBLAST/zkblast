import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient, encodeFunctionData, formatEther, getAddress, http, keccak256,
  type Abi, type Address, type Hex,
} from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8")) as any;
assert(manifest.perps && manifest.shieldedV2, "Perps deployment is not bound");
const artifact = async (file: string): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${file}.sol/${file}.json`), "utf8")) as { abi: Abi }).abi;
const [privateVaultAbi, engineAbi] = await Promise.all([artifact("PrivateVaultV2"), artifact("PerpEngine")]);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");
const governance = getAddress(manifest.roles.defaultAdmin);
const privateVault = getAddress(manifest.shieldedV2.vault);
const engine = getAddress(manifest.perps.engine);
const adapter = getAddress(manifest.perps.shieldedAdapter);
const [defaultAdminRole, riskAdminRole, adapterAuthorized, openingsPaused, gasPrice, block] = await Promise.all([
  client.readContract({ address: privateVault, abi: privateVaultAbi, functionName: "DEFAULT_ADMIN_ROLE" }),
  client.readContract({ address: engine, abi: engineAbi, functionName: "RISK_ADMIN_ROLE" }),
  client.readContract({ address: privateVault, abi: privateVaultAbi, functionName: "perpsAdapterAuthorized", args: [adapter] }),
  client.readContract({ address: engine, abi: engineAbi, functionName: "openingsPaused" }),
  client.getGasPrice(), client.getBlockNumber(),
]);
const [vaultAdmin, engineRiskAdmin] = await Promise.all([
  client.readContract({ address: privateVault, abi: privateVaultAbi, functionName: "hasRole", args: [defaultAdminRole, governance] }),
  client.readContract({ address: engine, abi: engineAbi, functionName: "hasRole", args: [riskAdminRole, governance] }),
]);
assert(vaultAdmin, "Governance does not administer PrivateVaultV2");
assert(engineRiskAdmin, "Governance does not hold PerpEngine risk role");
const actions: { name: string; target: Address; data: Hex; estimatedTargetGas: string }[] = [];
if (!openingsPaused) {
  const data = encodeFunctionData({ abi: engineAbi, functionName: "setOpeningsPaused", args: [true] });
  await client.call({ account: governance, to: engine, data });
  const gas = await client.estimateGas({ account: governance, to: engine, data });
  actions.push({ name: "pause-engine-openings", target: engine, data, estimatedTargetGas: gas.toString() });
}
if (!adapterAuthorized) {
  const data = encodeFunctionData({ abi: privateVaultAbi, functionName: "setPerpsAdapterAuthorization", args: [adapter, true] });
  await client.call({ account: governance, to: privateVault, data });
  const gas = await client.estimateGas({ account: governance, to: privateVault, data });
  actions.push({ name: "authorize-shielded-adapter", target: privateVault, data, estimatedTargetGas: gas.toString() });
}
const targetGas = actions.reduce((sum, action) => sum + BigInt(action.estimatedTargetGas), 0n);
const governanceOverhead = environment === "mainnet" ? 250_000n * BigInt(actions.length) : 0n;
const modeledGas = targetGas + governanceOverhead;
const feeCeiling = modeledGas * gasPrice * 2n;
const plan = {
  schemaVersion: 1,
  environment,
  chainId: manifest.chainId,
  observedBlock: block.toString(),
  governance,
  governanceWorkflow: environment === "mainnet" ? "safe-2-of-2" : "direct-wallet",
  preState: { openingsPaused, adapterAuthorized },
  actions: actions.map((action) => ({ ...action, calldataHash: keccak256(action.data) })),
  gas: {
    observedPriceWei: gasPrice.toString(),
    targetEstimate: targetGas.toString(),
    governanceOverhead: governanceOverhead.toString(),
    modeledTotal: modeledGas.toString(),
    feeCeilingWei: feeCeiling.toString(),
    feeCeilingEth: formatEther(feeCeiling),
  },
  invariants: [
    "no note, root, nullifier, liability or token balance mutation",
    "engine openings remain paused",
    "vault LP deposits and positions remain paused",
    "adapter authorization is limited to the deployed ShieldedPerpAdapter",
  ],
};
const output = path.join(root, `deployments/${environment}/perps-base-configuration-plan.json`);
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  environment, chainId: manifest.chainId, observedBlock: plan.observedBlock,
  workflow: plan.governanceWorkflow, actions: actions.map(({ name }) => name),
  modeledGas: plan.gas.modeledTotal, feeCeilingEth: plan.gas.feeCeilingEth, output,
}));
