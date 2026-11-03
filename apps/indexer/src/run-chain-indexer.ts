import { spawn } from "node:child_process";
import { getChainDescriptor } from "@zkblast/config";

const actions = new Set(["catchup", "start", "dev"] as const);
type Action = "catchup" | "start" | "dev";

const [, , requestedAction, requestedChainId] = process.argv;
if (!requestedAction || !actions.has(requestedAction as Action))
  throw new Error("INDEXER_ACTION_INVALID");

const chainId = Number(requestedChainId);
const descriptor = getChainDescriptor(chainId);
if (descriptor.environment !== "mainnet")
  throw new Error("INDEXER_MAINNET_CHAIN_REQUIRED");

const rpcUrl =
  descriptor.family === "hyperevm"
    ? process.env.HYPEREVM_MAINNET_RPC_URL
    : process.env.RPC_URL;
if (!rpcUrl) throw new Error(`${descriptor.slug.toUpperCase()}_RPC_URL_REQUIRED`);

const maximumLogRange = descriptor.indexer.maximumLogRange ?? 2_000;
const confirmations = descriptor.indexer.confirmations ?? 1;
const childEnvironment = {
  ...process.env,
  APP_ENV: descriptor.environment,
  CHAIN_ID: String(descriptor.chainId),
  CHAIN_NAME: descriptor.name,
  RPC_URL: rpcUrl,
  BLOCK_EXPLORER_URL: descriptor.explorerUrl ?? "",
  DEPLOYMENT_MANIFEST_PATH: descriptor.deploymentManifestPath,
  SUPABASE_SCHEMA: descriptor.databaseSchema,
  INDEXER_CONFIRMATIONS: String(confirmations),
  INDEXER_CATCHUP_CHUNK_SIZE: String(maximumLogRange),
  INDEXER_RPC_RANGE_DELAY_MS:
    descriptor.family === "hyperevm"
      ? (process.env.HYPEREVM_INDEXER_RPC_RANGE_DELAY_MS ?? "500")
      : (process.env.INDEXER_RPC_RANGE_DELAY_MS ?? "0"),
};

const child = spawn(
  "pnpm",
  ["--filter", "@zkblast/indexer", requestedAction],
  { env: childEnvironment, stdio: "inherit" },
);

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Indexer exited from signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
