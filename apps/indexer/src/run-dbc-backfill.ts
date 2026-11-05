import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { protocolAbis } from "@zkblast/abi";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  type Address,
  type Log,
} from "viem";
import { z } from "zod";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";
import { createIndexerTransport } from "./rpc-transport.js";

const runtime = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).default(5),
    DBC_BACKFILL_FROM_BLOCK: z.coerce.bigint().min(0n).optional(),
  })
  .parse(process.env);
const config = loadServerConfig(process.env);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.dbc) throw new Error("DBC_NOT_DEPLOYED");
const addresses = [
  manifest.dbc.configRegistry,
  manifest.dbc.launchFactory,
  manifest.dbc.curveQuoter,
  manifest.dbc.launchpadRouter,
  manifest.dbc.graduationManager,
  manifest.dbc.dammGraduationAdapter,
  manifest.dbc.lpAllocationEscrow,
  ...(manifest.launchpad
    ? [
        manifest.launchpad.tokenFactory,
        manifest.launchpad.feeCollector,
        manifest.launchpad.revenueSplitter,
      ].filter((address): address is string => Boolean(address))
    : []),
  ...(manifest.protectedLaunch
    ? [
        manifest.protectedLaunch.policyRegistry,
        manifest.protectedLaunch.launchFactory,
        manifest.protectedLaunch.launchRouter,
        manifest.protectedLaunch.tokenDeployer,
        manifest.protectedLaunch.virtualPoolDeployer,
        manifest.protectedLaunch.lpEscrow,
        manifest.protectedLaunch.graduationManager,
        manifest.protectedLaunch.dammGraduationAdapter,
        manifest.protectedLaunch.dlmmGraduationAdapter,
        manifest.protectedLaunch.identityRegistry,
      ].filter((address): address is string => Boolean(address))
    : []),
  ...(manifest.stockQuoteAssets
    ? [
        manifest.stockQuoteAssets.adapterRegistry,
        manifest.stockQuoteAssets.assetRegistry,
        manifest.stockQuoteAssets.oracleGuard,
        manifest.stockQuoteAssets.destinationRegistry,
      ]
    : []),
].map(getAddress);
const client = createPublicClient({
  cacheTime: 0,
  transport: createIndexerTransport(config.RPC_URL),
});
const repository = new PostgresIndexerRepository(
  runtime.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  "protocol",
  addresses,
);
const existing = await repository.dbcLaunchContractAddresses();
repository.trackDbcContracts(existing);
const tracked = new Set<Address>([...addresses, ...existing]);
const reader = new ViemChainReader(client, config.CHAIN_ID, [
  ...addresses,
  ...existing,
]);
const head =
  (await client.getBlockNumber()) - BigInt(runtime.INDEXER_CONFIRMATIONS);
let events = 0,
  blocks = 0;
const protectedDeploymentBlock = manifest.protectedLaunch?.deploymentBlock;
const defaultBackfillFrom = protectedDeploymentBlock === undefined
  ? BigInt(manifest.dbc.deploymentBlock)
  : BigInt(Math.min(manifest.dbc.deploymentBlock, protectedDeploymentBlock));
const backfillFrom = runtime.DBC_BACKFILL_FROM_BLOCK ?? defaultBackfillFrom;
for (let from = backfillFrom; from <= head; from += 2_000n) {
  const to = from + 1_999n > head ? head : from + 1_999n;
  const logs = await client.getLogs({
    address: [...tracked],
    fromBlock: from,
    toBlock: to,
  });
  const discovered: Address[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: Object.values(protocolAbis).flat(),
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName !== "TokenLaunched" &&
        decoded.eventName !== "ProtectedTokenLaunched"
      ) continue;
      const args = decoded.args as { token: Address; virtualPool: Address };
      for (const candidate of [
        getAddress(args.token),
        getAddress(args.virtualPool),
      ]) {
        if (!tracked.has(candidate)) {
          tracked.add(candidate);
          discovered.push(candidate);
        }
      }
    } catch {
      // Events outside the launch surface are ignored by this focused backfill.
    }
  }
  if (discovered.length > 0) {
    repository.trackDbcContracts(discovered);
    for (const contract of discovered)
      logs.push(
        ...(await client.getLogs({
          address: contract,
          fromBlock: from,
          toBlock: to,
        })),
      );
  }
  const grouped = new Map<bigint, Log[]>();
  for (const log of logs) {
    if (log.blockNumber === null) continue;
    const group = grouped.get(log.blockNumber) ?? [];
    group.push(log);
    grouped.set(log.blockNumber, group);
  }
  for (const [blockNumber, blockLogs] of [...grouped].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const block = await reader.block(blockNumber, blockLogs);
    events += await repository.backfillDbcEvents(block.events);
    blocks++;
  }
}
console.log(
  JSON.stringify(
    {
      environment: config.APP_ENV,
      chainId: config.CHAIN_ID,
      fromBlock: backfillFrom.toString(),
      toBlock: head.toString(),
      eventBlocks: blocks,
      events,
    },
    null,
    2,
  ),
);
await repository.close();
process.exit(0);
