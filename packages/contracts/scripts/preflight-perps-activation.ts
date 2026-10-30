import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, `deployments/${environment}/manifest.json`), "utf8")) as any;
assert(manifest.perps && manifest.shieldedV2, "Perps and Shielded v2 must be present in the manifest");
const artifact = async (file: string, name = file): Promise<Abi> =>
  (JSON.parse(await readFile(path.join(root, `packages/contracts/out/${file}.sol/${name}.json`), "utf8")) as { abi: Abi }).abi;
const [privateVaultAbi, vaultAbi, engineAbi, insuranceAbi, erc20Abi] = await Promise.all([
  artifact("PrivateVaultV2"), artifact("LiquidityVaultUSDG"), artifact("PerpEngine"),
  artifact("InsuranceFund"), artifact("MockERC20"),
]);
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
assert.equal(await client.getChainId(), manifest.chainId, "RPC chain mismatch");
const perps = manifest.perps;
const read = (address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) =>
  client.readContract({ address, abi, functionName, args } as never);
const safeRead = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) => {
  try { return await read(address, abi, functionName, args); } catch { return null; }
};
const upgraderRole = await read(manifest.shieldedV2.vault, privateVaultAbi, "UPGRADER_ROLE") as Hex;
const candidates = new Map<string, Address>();
for (const [label, address] of Object.entries({
  manifestDeployer: manifest.deployerAddress,
  manifestGovernance: manifest.roles.defaultAdmin,
  manifestUpgrader: manifest.roles.upgrader,
})) candidates.set(label, address as Address);
for (const name of ["DEPLOYER_PRIVATE_KEY", "GOVERNANCE_PRIVATE_KEY", "UPGRADER_PRIVATE_KEY"] as const) {
  const value = process.env[name];
  if (value && /^0x[0-9a-f]{64}$/iu.test(value)) candidates.set(name, privateKeyToAccount(value as `0x${string}`).address);
}
const upgradeRoleCandidates = Object.fromEntries(await Promise.all(
  [...candidates].map(async ([label, address]) => [label, {
    address,
    authorized: await read(manifest.shieldedV2.vault, privateVaultAbi, "hasRole", [upgraderRole, address]),
  }]),
));
const [
  adapterAuthorized, collateralEnabled, depositsPaused, withdrawalsPaused, positionsPaused,
  openingsPaused, depositCeiling, withdrawalCooldown, insuranceFeeShareBps,
  vaultAssets, totalShares, insuranceAssets, custodyCollateralBalance,
] = await Promise.all([
  safeRead(manifest.shieldedV2.vault, privateVaultAbi, "perpsAdapterAuthorized", [perps.shieldedAdapter]),
  read(manifest.shieldedV2.vault, privateVaultAbi, "assetEnabled", [perps.collateral]),
  read(perps.liquidityVault, vaultAbi, "depositsPaused"),
  read(perps.liquidityVault, vaultAbi, "withdrawalsPaused"),
  read(perps.liquidityVault, vaultAbi, "positionsPaused"),
  read(perps.engine, engineAbi, "openingsPaused"),
  read(perps.liquidityVault, vaultAbi, "depositCeiling"),
  read(perps.liquidityVault, vaultAbi, "withdrawalCooldown"),
  read(perps.liquidityVault, vaultAbi, "insuranceFeeShareBps"),
  read(perps.liquidityVault, vaultAbi, "totalAssets"),
  read(perps.liquidityVault, vaultAbi, "totalShares"),
  read(perps.insuranceFund, insuranceAbi, "assets"),
  read(perps.collateral, erc20Abi, "balanceOf", [manifest.shieldedV2.vault]),
]);

const configurationSteps = [
  ...(!adapterAuthorized ? ["authorize-shielded-adapter"] : []),
  ...(openingsPaused !== true ? ["pause-engine-openings"] : []),
];
console.log(JSON.stringify({
  environment,
  chainId: manifest.chainId,
  blockNumber: (await client.getBlockNumber()).toString(),
  state: {
    adapterAuthorizationSupported: adapterAuthorized !== null,
    adapterAuthorized,
    collateralEnabled,
    depositsPaused,
    withdrawalsPaused,
    positionsPaused,
    openingsPaused,
    depositCeiling: String(depositCeiling),
    withdrawalCooldown: String(withdrawalCooldown),
    insuranceFeeShareBps: String(insuranceFeeShareBps),
    vaultAssets: String(vaultAssets),
    totalShares: String(totalShares),
    insuranceAssets: String(insuranceAssets),
    custodyCollateralBalance: String(custodyCollateralBalance),
  },
  upgradeRoleCandidates,
  configurationSteps,
  safeForFunding: adapterAuthorized === true && collateralEnabled === true && openingsPaused === true
    && depositsPaused === true && positionsPaused === true,
}));
