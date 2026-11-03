import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { createPublicClient, getAddress, http } from "viem";

const CHAIN_ID = 999;
const SCHEMA = "zkblast_hyperevm_mainnet";
const MANIFEST_PATH = "deployments/hyperevm-mainnet/manifest.json";
const RPC_URL = process.env.HYPEREVM_MAINNET_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL;

assert(databaseUrl, "SUPABASE_DIRECT_DATABASE_URL is required");

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
assert.equal(manifest.protocol, "ZKBLAST");
assert.equal(manifest.environment, "mainnet");
assert.equal(manifest.chainId, CHAIN_ID);
assert.equal(manifest.chainName, "HyperEVM");
assert(manifest.dbc, "DBC deployment is missing");
assert(manifest.launchpad, "Launchpad deployment is missing");
assert.equal(manifest.shielded, undefined, "Shielded must remain disabled on HyperEVM");
assert.equal(manifest.shieldedV2, undefined, "Shielded v2 must remain disabled on HyperEVM");
assert.equal(manifest.perps, undefined, "Perps must remain disabled on HyperEVM");

const namedAddresses = new Map();
const addAddress = (name, value) => {
  if (!value) return;
  namedAddresses.set(name, getAddress(value));
};

for (const [name, value] of Object.entries(manifest.integration ?? {}))
  addAddress(`integration.${name}`, value);
for (const [name, deployment] of Object.entries(manifest.contracts ?? {})) {
  addAddress(`contracts.${name}.implementation`, deployment.implementationAddress);
  addAddress(`contracts.${name}.proxy`, deployment.proxyAddress);
}
for (const [name, value] of Object.entries(manifest.dbc ?? {}))
  if (typeof value === "string" && value.startsWith("0x")) addAddress(`dbc.${name}`, value);
for (const [name, value] of Object.entries(manifest.launchpad ?? {}))
  if (typeof value === "string" && value.startsWith("0x")) addAddress(`launchpad.${name}`, value);

const client = createPublicClient({ cacheTime: 0, transport: http(RPC_URL) });
const [rpcChainId, latestBlock] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
]);
assert.equal(rpcChainId, CHAIN_ID, `RPC returned chain ${rpcChainId}`);

const missingCode = [];
for (const [name, address] of namedAddresses) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") missingCode.push(`${name}:${address}`);
}
assert.deepEqual(missingCode, [], `Contracts without bytecode: ${missingCode.join(", ")}`);

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const registry = await sql.unsafe(
    `select chain_id::text,chain_key,chain_name,environment,native_currency_symbol,enabled
       from ${SCHEMA}.chain_registry where chain_id=$1`,
    [CHAIN_ID],
  );
  assert.equal(registry.length, 1, "HyperEVM chain registry row is missing");
  assert.deepEqual(
    registry[0],
    {
      chain_id: "999",
      chain_key: "hyperevm-mainnet",
      chain_name: "HyperEVM",
      environment: "mainnet",
      native_currency_symbol: "HYPE",
      enabled: true,
    },
  );

  const boundaries = await sql.unsafe(
    `select
       (select count(*)::int from ${SCHEMA}.ingestion_checkpoints where chain_id <> $1) as foreign_checkpoints,
       (select count(*)::int from ${SCHEMA}.protocol_events where chain_id <> $1) as foreign_events,
       (select count(*)::int from ${SCHEMA}.indexed_blocks where chain_id <> $1) as foreign_blocks`,
    [CHAIN_ID],
  );
  assert.deepEqual(boundaries[0], {
    foreign_checkpoints: 0,
    foreign_events: 0,
    foreign_blocks: 0,
  });

  const existing = await sql.unsafe(
    `select
       (select count(*)::int from ${SCHEMA}.ingestion_checkpoints where chain_id=$1) as checkpoints,
       (select count(*)::int from ${SCHEMA}.protocol_events where chain_id=$1) as events,
       (select count(*)::int from ${SCHEMA}.indexed_blocks where chain_id=$1) as blocks`,
    [CHAIN_ID],
  );

  console.log(JSON.stringify({
    status: "ready",
    chainId: rpcChainId,
    latestBlock: latestBlock.toString(),
    manifest: MANIFEST_PATH,
    schema: SCHEMA,
    contractsWithBytecode: namedAddresses.size,
    existingIndexerState: existing[0],
    enabledModules: ["core", "dbc", "launchpad", "damm-graduation"],
    disabledModules: ["shielded", "perps", "dlmm-graduation", "external-markets"],
    writesPerformed: false,
  }, null, 2));
} finally {
  await sql.end();
}
