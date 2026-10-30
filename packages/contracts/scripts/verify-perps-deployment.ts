import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";

const bases = [
  "PerpMarketRegistry",
  "ChainlinkOracleAdapter",
  "FundingRateModule",
  "PerpEngine",
  "InsuranceFund",
  "LiquidityVaultUSDG",
  "ShieldedPerpAdapter",
] as const;
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

const environment = process.env.APP_ENV?.toLowerCase();
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
assert(process.env.RPC_URL, "RPC_URL is required");

const planPath = path.resolve(process.cwd(), `../../deployments/${environment}/perps-v1-plan.json`);
const plan = JSON.parse(await readFile(planPath, "utf8")) as {
  chainId: number;
  order: string[];
  addresses: Record<string, Address>;
};
const client = createPublicClient({ transport: http(process.env.RPC_URL) });
assert.equal(await client.getChainId(), plan.chainId, "RPC chain does not match deployment plan");
const addressOf = (name: string): Address => {
  const address = plan.addresses[name];
  assert(address, `${name}: address is missing from deployment plan`);
  return address;
};

for (const name of plan.order) {
  const code = await client.getCode({ address: addressOf(name) });
  assert(code && code !== "0x", `${name}: runtime bytecode is missing`);
}

for (const base of bases) {
  const stored = await client.getStorageAt({
    address: addressOf(`${base}Proxy`),
    slot: implementationSlot,
  });
  assert(stored, `${base}: implementation slot is empty`);
  const implementation = `0x${stored.slice(-40)}`.toLowerCase();
  assert.equal(
    implementation,
    addressOf(`${base}Implementation`).toLowerCase(),
    `${base}: implementation slot mismatch`,
  );
}

console.log(JSON.stringify({
  environment,
  chainId: plan.chainId,
  contractsWithCode: plan.order.length,
  verifiedProxySlots: bases.length,
  adapter: addressOf("ShieldedPerpAdapterProxy"),
}));
